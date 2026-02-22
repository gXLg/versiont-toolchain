// To a future reader:
// I'm terribly sorry for what you are going to witness here
// Yes, I know it's spaghetti code
// Yes, I am going to refactor it at some point
// No, not now
// Amen

const fs = require("fs");

function brackets(string, start, endChar) {
  let runner = start;
  let counter = 0;
  while (runner < string.length) {
    const char = string[++runner];
    if (char === "<") {
      counter ++;
    } else if (char === ">") {
      counter --;
    } else if (char === endChar && counter === 0) {
      return runner;
    }
  }
  return runner;
}

function typeTree(type, additionalClasses, shortClassNames, isInterface) {
  if (type in shortClassNames) {
    return typeTree(shortClassNames[type], additionalClasses, shortClassNames, isInterface);
  }
  if (type.endsWith("[]")) {
    const main = typeTree(type.slice(0, -2), additionalClasses, shortClassNames);
    return { "type": "array", main, "wrapped": main.wrapped, "generic": main.generic };
  }
  if (type.endsWith(">")) {
    const start = type.indexOf("<");
    let runner = start;
    let last = runner;
    let counter = 1;
    const gens = [];
    while (counter) {
      const char = type[++runner];
      if (char === "<") {
        counter ++;
      } else if (char === ">") {
        counter --;
        if (!counter) {
          gens.push(type.slice(last + 1, runner).trim());
        }
      } else if (char === "," && counter === 1) {
        gens.push(type.slice(last + 1, runner).trim());
        last = runner;
      }
    }
    const rmain = type.slice(0, start);
    const main = shortClassNames[rmain] ?? rmain;
    if (main.includes("/") || main.startsWith("!")) {
      console.log("Wrapper classes/interfaces shouldn't be generic!");
      process.exit(1);
    }
    const generics = gens.map(g => typeTree(g, additionalClasses, shortClassNames));
    return { "type": "generic", main, generics, "wrapped": generics.some(g => g.wrapped), "generic": true };
  }
  if (type.includes("/") || type.startsWith("!")) {
    if (type.startsWith("!")) {
      type = type.slice(1);
    }
    additionalClasses.push({ "parent": (isInterface ? "interface " : "class ") + type, "children": [] });
    const main = "dev.gxlg.versiont.gen." + type.split("/").slice(-1)[0] + (isInterface ? "I" : "");
    return { "type": "wrapper", main, "wrapped": true, "generic": false };
  }
  if (type === "void") {
    return { "type": "void", "main": "void", "wrapped": false, "generic": false };
  }
  if (type === "Object") {
    return { "type": "object", "main": "java.lang.Object", "wrapped": false, "generic": false };
  }
  if (type === "Class") {
    return { "type": "class", "main": "R.RClass", "wrapped": true, "generic": false };
  }
  return { "type": "java", "main": type, "wrapped": false, "generic": false };
}

function buildTypeString(tree) {
  const { type, main, generics } = tree;
  if (type === "array") {
    return buildTypeString(main) + "[]";
  }
  if (type === "generic") {
    return main.replaceAll("$", ".") + "<" + generics.map(g => buildTypeString(g)).join(", ") + ">";
  }
  if (type === "wrapper") {
    return main;
  }
  return main.replaceAll("$", ".");
}

function buildClassGetter(tree) {
  const { type, main } = tree;
  if (type === "array") {
    return buildClassGetter(main) + ".arrayType()";
  }
  if (type === "wrapper") {
    return main + ".clazz.self()";
  }
  if (type === "class") {
    return "Class.class"
  }
  return main.replaceAll("$", ".") + ".class";
}

function buildSignatureType(tree) {
  const { type, main } = tree;
  if (type === "array") {
    return buildSignatureType(main) + "[]";
  }
  return main;
}

function buildWrapper(tree) {
  const { type, main, generics, wrapped, generic } = tree;
  if (type === "void" || type === "object") {
    return "%";
  } else if (type === "java") {
    return `(${main}) %`;
  } else if (type === "wrapper") {
    return `R.wrapperInst(${main}.class, %)`;
  } else if (type === "array") {
    if (!wrapped && !generic) {
      return `(${main.main}[]) %`;
    }
    return `R.nullSafe(R.arrayWrapper(${_buildWrapper(main)})).apply(%)`;
  } else if (type === "generic") {
    const path = definedAdapters[main];
    if (path == null) {
      console.log("Generic adapter for", main, "is not defined!");
      process.exit(1);
    }
    return `R.nullSafe(${path}.wrapper(${generics.map(_buildWrapper).join(", ")})).apply(%)`;
  } else if (type === "class") {
    return "R.clz((Class<?>) %)";
  }
}

function _buildWrapper(tree) {
  const { type, main, generics, wrapped, generic } = tree;
  if (type === "object") {
    return "x -> x";
  } else if (type === "java") {
    return `x -> (${main}) x`;
  } else if (type === "wrapper") {
    return `x -> R.wrapperInst(${main}.class, x)`;
  } else if (type === "array") {
    if (!wrapped && !generic) {
      return `x -> (${main.main}[]) x`;
    }
    return `R.arrayWrapper(${_buildWrapper(main)})`;
  } else if (type === "generic") {
    const path = definedAdapters[main];
    if (path == null) {
      console.log("Generic adapter for", main, "is not defined!");
      process.exit(1);
    }
    return `${path}.wrapper(${generics.map(_buildWrapper).join(", ")})`;
  } else if (type === "class") {
    return "x -> R.clz((Class<?>) x)";
  }
}

function buildUnwrapper(tree) {
  const { type, main, generics, wrapped } = tree;
  if (!wrapped) {
    return "%";
  }
  if (type === "void" || type === "object" || type === "java") {
    return `%`;
  } else if (type === "wrapper") {
    return `R.unwrapWrapper(%)`;
  } else if (type === "array") {
    return `R.nullSafe(R.<${buildTypeString(main)}>arrayUnwrapper(${_buildUnwrapper(main)})).apply(%)`;
  } else if (type === "generic") {
    const path = definedAdapters[main];
    if (path == null) {
      console.log("Generic adapter for", main, "is not defined!");
      process.exit(1);
    }
    return `R.nullSafe(${path}.<${generics.map(buildTypeString).join(", ")}>unwrapper(${generics.map(_buildUnwrapper).join(", ")})).apply(%)`;
  } else if (type === "class") {
    return `%.self()`;
  }
}

function _buildUnwrapper(tree) {
  const { type, main, generics, wrapped } = tree;
  if (!wrapped) {
    return "x -> x";
  }
  if (type === "object" || type === "java") {
    return `x -> x`;
  } else if (type === "wrapper") {
    return `x -> R.unwrapWrapper(x)`;
  } else if (type === "array") {
    return `R.arrayUnwrapper(${_buildUnwrapper(main)})`;
  } else if (type === "generic") {
    const path = definedAdapters[main];
    if (path == null) {
      console.log("Generic adapter for", main, "is not defined!");
      process.exit(1);
    }
    return `${path}.unwrapper(${generics.map(_buildUnwrapper).join(", ")})`;
  } else if (type === "class") {
    return `x -> x.self()`;
  }
}

function whitespace(line) {
  const tline = line.trimStart();
  return [line.length - tline.length, tline.trimEnd()];
}

function processPart(children, lines, start=0) {
  while (lines.length) {
    const [ws, parent] = whitespace(lines[0]);
    if (ws < start) {
      return;
    } else if (ws === start) {
      children.push({ parent, "children": [] });
      lines.shift();
    } else if (ws > start) {
      const parent = children.slice(-1)[0];
      processPart(parent.children, lines, ws);
    }
  }
}

function getMethodName(rawMethodName, argumentsSignature, signatures) {
  const methodSignature = rawMethodName + "(" + argumentsSignature.join(",") + ")";
  if (methodSignature in signatures) {
    const id = signatures[methodSignature] + 1;
    signatures[methodSignature] = id;
    return rawMethodName + id.toString();
  } else {
    signatures[methodSignature] = 1;
    return rawMethodName;
  }
}

const inputFile = process.argv[2];
const outputDir = process.argv[3];

if (!inputFile) {
  console.log("No input file provided!");
  process.exit(1);
}

if (!outputDir) {
  console.log("No output directory specified!");
  process.exit(1);
}
const file = fs.readFileSync(inputFile, "utf-8").trim();

const rlines = file.split("\n").map(l => l.split("#")[0].trimEnd()).filter(l => l.trim().length);
const shortClassNames = { "[Object]": "!java.lang.Object" };
const definedAdapters = {};
const lines = [];
for (const line of rlines) {
  if (line.startsWith("import ")) {
    const className = line.slice(7).trimStart();
    const shortName = className.split(".").slice(-1)[0];
    shortClassNames[shortName] = className;
  } else if (line.startsWith("adapter ")) {
    const [cls, path] = line.slice(8).trimStart().split(" -> ");
    definedAdapters[cls] = path;
  } else {
    lines.push(line);
  }
}

const classes = [{ "parent": "class [Object]", "children": [] }];
const additionalClasses = [];
processPart(classes, lines);

// fileName: content
const processedClasses = {};

const classesInheritance = {};

function processClass(part) {
  if (part.parent.startsWith("interface ")) {
    processInterface(part);
    return;
  }

  if (!part.parent.startsWith("class ")) {
    console.log("Invalid entrypoint: needs to be either class or interface!");
    process.exit(1);
  }

  const parts = part.parent.slice(6).trimStart().split(/ +/);
  const leftClass = parts.shift();
  let extendingClassString = null;
  if (parts[0] === "extends") {
    parts.shift();
    const tree = typeTree(parts.shift(), additionalClasses, shortClassNames);
    if (tree.type !== "wrapper") {
      console.log("Wrapper class can only extend other Wrapper classes!");
      process.exit(1);
    }
    extendingClassString = tree.main;
  }
  const implementingInterfaces = [];
  if (parts[0] === "implements") {
    parts.shift();
    while (parts.length) {
      const c = parts.shift();
      const tree = typeTree(c, additionalClasses, shortClassNames, true);
      if (tree.type !== "wrapper") {
        console.log("Wrapper class can only implement other Wrapper interfaces!");
        process.exit(1);
      }
      implementingInterfaces.push(tree.main);
    }
  }

  // parse class name
  const rGetter = shortClassNames[leftClass] ?? leftClass
  const reflectionClassGetter = rGetter.startsWith("!") ? rGetter.slice(1) : rGetter;
  const fullyQualified = "dev.gxlg.versiont.gen." + reflectionClassGetter.split("/").slice(-1)[0];
  if (fullyQualified in processedClasses) {
    return;
  }

  if (extendingClassString == null && fullyQualified !== "dev.gxlg.versiont.gen.java.lang.Object") {
    extendingClassString = "dev.gxlg.versiont.gen.java.lang.Object";
  }

  if (extendingClassString != null) {
    if (!(extendingClassString in classesInheritance)) {
        classesInheritance[extendingClassString] = [];
    }
    classesInheritance[extendingClassString].push(fullyQualified);
  }

  const className = fullyQualified.split(".").slice(-1)[0];
  const javaPackage = fullyQualified.split(".").slice(0, -1).join(".");

  // work out the body
  const staticMethods = [];
  const instanceMethods = [];

  const instanceFields = [];
  const instanceFieldInitializers = [];

  const constructors = [];
  const instanceMethodSignatures = { "unwrap()": 1, "unwrap(Class)": 1 };
  instanceMethodSignatures[`equals(${fullyQualified})`] = 1;
  const staticMethodSignatures = { };

  const wrappedMethods = [];

  for (const child of part.children) {
    if (child.parent.includes("<init>")) {
      // constructor

      let lineToParse = child.parent;

      const argumentsToParse = lineToParse.split("(")[1].split(")")[0].trim();
      const afterArguments = lineToParse.split(")")[1];
      if (afterArguments.startsWith(" throws ")) {
        console.log("Constructor exceptions are not yet supported!");
        process.exit(1);
      }

      const arguments = [];
      let runner = 0;
      while (runner < argumentsToParse.length) {
        const argumentTypeIndex = brackets(argumentsToParse, runner, " ");
        const argumentTypeTree = typeTree(argumentsToParse.slice(runner, argumentTypeIndex), additionalClasses, shortClassNames);
        const separatorIndex = brackets(argumentsToParse, argumentTypeIndex + 1, ",")
        const argumentName = argumentsToParse.slice(argumentTypeIndex + 1, separatorIndex);
        runner = separatorIndex + 1;
        while (runner < argumentsToParse.length && argumentsToParse[runner] === " ") {
          runner ++;
        }
        arguments.push({ "name": argumentName, "type": argumentTypeTree });
      }

      // normal constructor
      constructors.push(
        `    public ${className}(${arguments.map(a => buildTypeString(a.type) + " " + a.name).join(", ")}) {\n` +
        `        this(clz -> clz.constr(${arguments.map(a => buildClassGetter(a.type)).join(", ")}).newInst(${arguments.map(a => buildUnwrapper(a.type).replace("%", a.name)).join(", ")}).self());\n` +
        `    }`
      );

    } else if (child.parent.includes("(")) {
      // method

      let lineToParse = child.parent;
      const toAccess = lineToParse.startsWith("accessible ");
      if (toAccess) {
        lineToParse = lineToParse.slice(11).trimStart();
      }
      const isProtected = lineToParse.startsWith("protected ");
      if (isProtected) {
        lineToParse = lineToParse.slice(10).trimStart();
      }
      const isPrivate = lineToParse.startsWith("private ");
      if (isPrivate) {
        lineToParse = lineToParse.slice(8).trimStart();
      }
      const isStatic = lineToParse.startsWith("static ");
      if (isStatic) {
        lineToParse = lineToParse.slice(6).trimStart();
      }
      const isFinal = lineToParse.startsWith("final ");
      if (isFinal) {
        lineToParse = lineToParse.slice(6).trimStart();
      }
      const isNullable = lineToParse.startsWith("@Nullable ");
      if (isNullable) {
        lineToParse = lineToParse.slice(10).trimStart();
      }

      if (isPrivate) {
        if (isProtected) {
          console.log("Can't mix 'protected' and 'private' methods!");
          process.exit(1);
        }
        if (!toAccess) {
          console.log("Private methods without an accessor don't make sense for wrappers!");
          process.exit(1);
        }
      }

      if (isStatic) {
        if (isPrivate) {
          console.log("Private static methods don't make sense for wrappers!");
          process.exit(1);
        }
      }

      if (toAccess) {
        if (!isPrivate && !isProtected) {
          console.log("Creating an accessor for public methods doesn't make sense for wrappers!");
          process.exit(1);
        }
      }

      const signatures = isStatic ? staticMethodSignatures : instanceMethodSignatures;

      const returnTypeIndex = brackets(lineToParse, 0, " ");
      const returnTypeTree = typeTree(lineToParse.slice(0, returnTypeIndex), additionalClasses, shortClassNames);

      if (returnTypeTree.type === "void") {
        if (isNullable) {
          console.log("Void methods can't be nullable!");
          process.exit(1);
        }
      }

      const reflectionMethodGetter = lineToParse.slice(returnTypeIndex + 1).trimStart().split("(")[0];
      const argumentsToParse = lineToParse.split("(")[1].split(")")[0].trim();
      const afterArguments = lineToParse.split(")")[1];
      const exceptions = afterArguments.startsWith(" throws ") ? afterArguments.split(" throws ").slice(-1)[0].trim() : null;
      const arguments = [];
      let runner = 0;
      while (runner < argumentsToParse.length) {
        const argumentTypeIndex = brackets(argumentsToParse, runner, " ");
        const argumentTypeTree = typeTree(argumentsToParse.slice(runner, argumentTypeIndex), additionalClasses, shortClassNames);
        const separatorIndex = brackets(argumentsToParse, argumentTypeIndex + 1, ",")
        const argumentName = argumentsToParse.slice(argumentTypeIndex + 1, separatorIndex);
        runner = separatorIndex + 1;
        while (runner < argumentsToParse.length && argumentsToParse[runner] === " ") {
          runner ++;
        }
        arguments.push({ "name": argumentName, "type": argumentTypeTree });
      }

      const rawMethodName = reflectionMethodGetter.split("/").slice(-1)[0];
      const argumentsSignature = arguments.map(a => buildSignatureType(a.type));
      const methodName = getMethodName(rawMethodName, argumentsSignature, signatures);
      const thrownExceptions = exceptions == null ? `` : `throws ${exceptions} `;
      const catchClause = exceptions == null ? `` : `        } catch (${exceptions} e) {\n            throw e;\n`;

      const methodParent = isStatic ? "clazz" : "this.rInstance";
      const methodsArray = isStatic ? staticMethods : instanceMethods;
      const access = isProtected ? "protected" : (isPrivate ? "private" : "public");
      const modifier = isStatic ? "static " : (isFinal ? "final " : "");
      const exec = `${methodParent}.mthd("${reflectionMethodGetter}", ${buildClassGetter(returnTypeTree)}${arguments.map(a => ", " + buildClassGetter(a.type)).join("")}).invk(${arguments.map(a => buildUnwrapper(a.type).replace("%", a.name)).join(", ")})`;
      const body = returnTypeTree.type === "void" ? exec : `return ${buildWrapper(returnTypeTree).replace("%", exec)}`;
      const annotation = isNullable ? `    @org.jetbrains.annotations.Nullable\n` : ``;
      methodsArray.push(
        `${annotation}` +
        `    ${access} ${modifier}${buildTypeString(returnTypeTree)} ${methodName}(${arguments.map(a => buildTypeString(a.type) + " " + a.name).join(", ")}) ${thrownExceptions}{\n` +
        `        try {\n` +
        `            ${body};\n` +
        `${catchClause}` +
        `        } catch (Throwable e) {\n` +
        `            throw new RuntimeException(e);\n` +
        `        }\n` +
        `    }`
      );
      if (!isFinal && !isPrivate && !isStatic) {
        const exec = `((${className}) wrapper).${methodName}(${arguments.map((a, i) => buildWrapper(a.type).replace("%", "args[" + i + "]")).join(", ")})`;
        const body = returnTypeTree.type === "void" ? `{ ${exec}; return null; }` : `${buildUnwrapper(returnTypeTree).replace("%", exec)}`;

        wrappedMethods.push(
          `        new WrappedMethod(\n` +
          `            m -> (${reflectionMethodGetter.split("/").map(g => "m.getName().equals(\"" + g + "\")").join(" || ")}) && R.methodMatches(m, ${buildClassGetter(returnTypeTree)}${arguments.map(a => ", " + buildClassGetter(a.type)).join("")}),\n` +
          `            (wrapper, args) -> ${body}\n` +
          `        )`
        );
      }

      if (toAccess) {
        const rawMethodName = reflectionMethodGetter.split("/").slice(-1)[0] + "Accessible";
        const accMethodName = getMethodName(rawMethodName, argumentsSignature, signatures);
        const returnStatement = returnTypeTree.type === "void" ? "" : "return ";
        methodsArray.push(
          `${annotation}` +
          `    public ${modifier}${buildTypeString(returnTypeTree)} ${accMethodName}(${arguments.map(a => buildTypeString(a.type) + " " + a.name).join(", ")}) ${thrownExceptions}{\n` +
          `        ${returnStatement}${methodName}(${arguments.map(a => a.name).join(", ")});\n` +
          `    }`
        );
      }

    } else if (child.parent.startsWith("class ") || child.parent.startsWith("interface ")) {
      // class
      classes.push(child);

    } else {
      // field

      let lineToParse = child.parent;
      const toAccess = lineToParse.startsWith("accessible ");
      if (toAccess) {
        lineToParse = lineToParse.slice(11).trimStart();
      }
      const isNullable = lineToParse.startsWith("@Nullable ");
      if (isNullable) {
        lineToParse = lineToParse.slice(10).trimStart();
      }
      const isStatic = lineToParse.startsWith("static ");
      if (isStatic) {
        lineToParse = lineToParse.slice(7).trimStart();
      }
      const isFinal = lineToParse.startsWith("final ");
      if (isFinal) {
        lineToParse = lineToParse.slice(6).trimStart();
      }

      const fieldTypeIndex = brackets(lineToParse, 0, " ");
      const fieldTypeTree = typeTree(lineToParse.slice(0, fieldTypeIndex), additionalClasses, shortClassNames);

      if (fieldTypeTree.type === "void") {
        console.log("Fields can't be of type void!");
        process.exit(1);
      }

      const reflectionFieldGetter = lineToParse.slice(fieldTypeIndex + 1).trim();
      const fieldName = reflectionFieldGetter.split("/").slice(-1)[0] + (toAccess ? "Accessible" : "") + (isStatic ? "" : "Field");
      const fieldTypeString = buildTypeString(fieldTypeTree);

      if (isStatic) {
        const fieldMethodName = getMethodName(fieldName, [], staticMethodSignatures);
        const exec = `clazz.fld("${reflectionFieldGetter}", ${buildClassGetter(fieldTypeTree)}).get()`;
        const body = `return ${buildWrapper(fieldTypeTree).replace("%", exec)}`;
        const annotation = isNullable ? `    @org.jetbrains.annotations.Nullable\n` : ``;

        staticMethods.push(
          `${annotation}` +
          `    public static ${fieldTypeString} ${fieldMethodName}() {\n` +
          `        ${body};\n` +
          `    }`
        );
        if (!isFinal) {
          const fieldMethodName2 = getMethodName(fieldName, [buildSignatureType(fieldTypeTree)], staticMethodSignatures);
          instanceMethods.push(
            `    public static void ${fieldMethodName2}(${fieldTypeString} value) {\n` +
            `        clazz.fld("${reflectionFieldGetter}", ${buildClassGetter(fieldTypeTree)}).set(${buildUnwrapper(fieldTypeTree).replace("%", "value")});\n` +
            `    }`
          );
        }

      } else {
        instanceFields.push(`    private final R.RField ${fieldName};`);
        instanceFieldInitializers.push(`        this.${fieldName} = rInstance.fld("${reflectionFieldGetter}", ${buildClassGetter(fieldTypeTree)});`);

        const capitalName = fieldName.slice(0, 1).toUpperCase() + fieldName.slice(1);
        const getterMethodName = getMethodName("get" + capitalName, [], instanceMethodSignatures);

        const exec = `this.${fieldName}.get()`;
        const body = `return ${buildWrapper(fieldTypeTree).replace("%", exec)}`;
        const annotation = isNullable ? `    @org.jetbrains.annotations.Nullable\n` : ``;

        instanceMethods.push(
          `${annotation}` +
          `    public final ${fieldTypeString} ${getterMethodName}() {\n` +
          `        ${body};\n` +
          `    }`
        );
        if (!isFinal) {
          const setterMethodName = getMethodName("set" + capitalName, [buildSignatureType(fieldTypeTree)], instanceMethodSignatures);
          instanceMethods.push(
            `    public final void ${setterMethodName}(${fieldTypeString} value) {\n` +
            `        this.${fieldName}.set(${buildUnwrapper(fieldTypeTree).replace("%", "value")});\n` +
            `    }`
          );
        }
      }
    }
  }

  const impl = implementingInterfaces.length ? " implements " + implementingInterfaces.join(", ") : "";

  processedClasses[fullyQualified] = (
    `package ${javaPackage};\n` +
    `\n` +
    `import dev.gxlg.versiont.api.R;\n` +
    `import dev.gxlg.versiont.api.types.Wrapper;\n` +
    `import dev.gxlg.versiont.api.types.WrappedMethod;\n` +
    `\n` +
    `import java.util.List;\n` +
    `import java.util.ArrayList;\n` +
    `\n` +
    `public class ${className} extends ${extendingClassString ?? "Wrapper<" + className + ">"}${impl} {\n` +
    `    public static final R.RClass clazz = R.clz("${reflectionClassGetter}");\n` +
    `\n` +
    `    public static final List<Class<? extends ${className}>> subClazzes = List.of(%subclasses%);\n` +
    `\n` +
    `    public static final List<WrappedMethod> wrappedMethods = List.of(\n` +
    `${wrappedMethods.join(",\n")}\n` +
    `    );\n` +
    `\n` +
    `    private final R.RInstance rInstance;\n` +
    `\n` +
    `${instanceFields.join("\n\n")}\n` +
    `\n` +
    `${constructors.join("\n\n")}\n` +
    `\n` +
    `    protected ${className}(Wrapper.DelayedConstructor delayedConstructor) {\n` +
    `        super(delayedConstructor);\n` +
    `        rInstance = clazz.inst(instance);\n` +
    `${instanceFieldInitializers.join("\n")}\n` +
    `    }\n` +
    `\n` +
    `${instanceMethods.join("\n\n")}\n` +
    `\n` +
    `${staticMethods.join("\n\n")}\n` +
    `}`
  ).replace(/\n *\n+/g, "\n\n").replace(/\n+( *})/g, "\n$1");
}

function processInterface(part) {
  const parts = part.parent.slice(9).trimStart().split(/ +/);
  const leftClass = parts.shift();
  const extendingInterfaces = [];
  if (parts[0] === "extends") {
    parts.shift();
    while (parts.length) {
      const c = parts.shift();
      const tree = typeTree(c, additionalClasses, shortClassNames, true);
      if (tree.type !== "wrapper") {
        console.log("Wrapper interface can only extend other Wrapper interfaces!");
        process.exit(1);
      }
      extendingInterfaces.push(tree.main);
    }
  }

  // parse class name
  const rGetter = shortClassNames[leftClass] ?? leftClass
  const reflectionClassGetter = rGetter.startsWith("!") ? rGetter.slice(1) : rGetter;
  const fullyQualified = "dev.gxlg.versiont.gen." + reflectionClassGetter.split("/").slice(-1)[0] + "I";
  if (fullyQualified in processedClasses) {
    return;
  }
  additionalClasses.push({ "parent": "class " + reflectionClassGetter, "children": [] });

  const className = fullyQualified.split(".").slice(-1)[0];
  const wrapperClassName = className.slice(0, -1);
  const javaPackage = fullyQualified.split(".").slice(0, -1).join(".");

  // work out the body
  const instanceMethods = [];
  const wrappedMethods = [];

  const instanceMethodSignatures = { "unwrap()": 1, "unwrap(Class)": 1 };
  instanceMethodSignatures[`as${wrapperClassName}`] = 1;

  for (const child of part.children) {
    if (child.parent.startsWith("<init>")) {
      // constructor
      console.log("Interfaces can't have constructors!");
      process.exit(1);

    } else if (child.parent.includes("(")) {
      // method
      if (child.parent.startsWith("static ")) {
        console.log("Interface wrappers shouldn't have static methods, declare them on the class instead!");
        process.exit(1);
      }

      let lineToParse = child.parent;
      const isDefault = lineToParse.startsWith("default ");
      if (isDefault) {
        lineToParse = lineToParse.slice(8);
      }
      const isNullable = lineToParse.startsWith("@Nullable ");
      if (isNullable) {
        lineToParse = lineToParse.slice(10);
      }

      const returnTypeIndex = brackets(lineToParse, 0, " ");
      const returnTypeTree = typeTree(lineToParse.slice(0, returnTypeIndex), additionalClasses, shortClassNames);

      const reflectionMethodGetter = lineToParse.slice(returnTypeIndex + 1).trimStart().split("(")[0];
      const argumentsToParse = lineToParse.split("(")[1].split(")")[0].trim();
      const afterArguments = lineToParse.split(")")[1];
      const exceptions = afterArguments.startsWith(" throws ") ? afterArguments.split(" throws ").slice(-1)[0].trim() : null;
      const arguments = [];
      let runner = 0;
      while (runner < argumentsToParse.length) {
        const argumentTypeIndex = brackets(argumentsToParse, runner, " ");
        const argumentTypeTree = typeTree(argumentsToParse.slice(runner, argumentTypeIndex), additionalClasses, shortClassNames);
        const separatorIndex = brackets(argumentsToParse, argumentTypeIndex + 1, ",")
        const argumentName = argumentsToParse.slice(argumentTypeIndex + 1, separatorIndex);
        runner = separatorIndex + 1;
        while (runner < argumentsToParse.length && argumentsToParse[runner] === " ") {
          runner ++;
        }
        arguments.push({ "name": argumentName, "type": argumentTypeTree });
      }

      const rawMethodName = reflectionMethodGetter.split("/").slice(-1)[0];
      const argumentsSignature = arguments.map(a => buildSignatureType(a.type));
      const methodName = getMethodName(rawMethodName, argumentsSignature, instanceMethodSignatures);
      const thrownExceptions = exceptions == null ? `` : `throws ${exceptions} `;
      const catchClause = exceptions == null ? `` : `        } catch (${exceptions} e) {\n            throw e;\n`;
      const annotation = isNullable ? `    @org.jetbrains.annotations.Nullable\n` : ``;

      if (isDefault) {
        const methodParent = `${wrapperClassName}.clazz.inst(unwrap())`;
        const exec = `${methodParent}.mthd("${reflectionMethodGetter}", ${buildClassGetter(returnTypeTree)}${arguments.map(a => ", " + buildClassGetter(a.type)).join("")}).invk(${arguments.map(a => buildUnwrapper(a.type).replace("%", a.name)).join(", ")})`;
        const body = returnTypeTree.type === "void" ? exec : `return ${buildWrapper(returnTypeTree).replace("%", exec)}`;
        instanceMethods.push(
          `${annotation}` +
          `    default ${buildTypeString(returnTypeTree)} ${methodName}(${arguments.map(a => buildTypeString(a.type) + " " + a.name).join(", ")}) ${thrownExceptions}{\n` +
          `        try {\n` +
          `            ${body};\n` +
          `${catchClause}` +
          `        } catch (Throwable e) {\n` +
          `            throw new RuntimeException(e);\n` +
          `        }\n` +
          `    }`
        );
      } else {
        instanceMethods.push(
          `${annotation}` +
          `    ${buildTypeString(returnTypeTree)} ${methodName}(${arguments.map(a => buildTypeString(a.type) + " " + a.name).join(", ")})${thrownExceptions === "" ? "" : " " + thrownExceptions};`
        );
      }

      const exec = `((${className}) wrapper).${methodName}(${arguments.map((a, i) => buildWrapper(a.type).replace("%", "args[" + i + "]")).join(", ")})`;
      const body = returnTypeTree.type === "void" ? `{ ${exec}; return null; }` : `${buildUnwrapper(returnTypeTree).replace("%", exec)}`;

      wrappedMethods.push(
        `        new WrappedMethod(\n` +
        `            m -> (${reflectionMethodGetter.split("/").map(g => "m.getName().equals(\"" + g + "\")").join(" || ")}) && R.methodMatches(m, ${buildClassGetter(returnTypeTree)}${arguments.map(a => ", " + buildClassGetter(a.type)).join("")}),\n` +
        `            (wrapper, args) -> ${body}\n` +
        `        )`
      );

    } else if (child.parent.startsWith("class ") || child.parent.startsWith("interface ")) {
      console.log("Interface wrappers shouldn't have inner classes/interfaces!");
      process.exit(1);

    } else {
      // field
      console.log("Interfaces can't have fields!");
      process.exit(1);
    }
  }

  const ext = extendingInterfaces.length ? extendingInterfaces.map(i => ", " + i).join("") : "";

  processedClasses[fullyQualified] = (
    `package ${javaPackage};\n` +
    `\n` +
    `import dev.gxlg.versiont.api.R;\n` +
    `import dev.gxlg.versiont.api.types.WrapperInterface;\n` +
    `import dev.gxlg.versiont.api.types.RedirectedCall;\n` +
    `import dev.gxlg.versiont.api.types.WrappedMethod;\n` +
    `\n` +
    `import java.lang.reflect.InvocationHandler;\n` +
    `import java.lang.reflect.Proxy;\n` +
    `import java.lang.reflect.Method;\n` +
    `import java.util.Collections;\n` +
    `import java.util.List;\n` +
    `import java.util.Map;\n` +
    `import java.util.WeakHashMap;\n` +
    `\n` +
    `public interface ${className} extends WrapperInterface${ext} {\n` +
    `    Class<?> wrapper = ${wrapperClassName}.class;\n` +
    `\n` +
    `    R.RClass clazz = ${wrapperClassName}.clazz;\n` +
    `\n` +
    `    Map<${className}, ${wrapperClassName}> instances = Collections.synchronizedMap(new WeakHashMap<>());\n` +
    `\n` +
    `    List<WrappedMethod> wrappedMethods = List.of(\n` +
    `${wrappedMethods.join(",\n")}\n` +
    `    );\n` +
    `\n` +
    `${instanceMethods.join("\n\n")}\n` +
    `\n` +
    `    @Override\n` +
    `    default java.lang.Object unwrap() {\n` +
    `        return as${wrapperClassName}().unwrap();\n` +
    `    }\n` +
    `\n` +
    `    default ${wrapperClassName} as${wrapperClassName}() {\n` +
    `        return instances.computeIfAbsent(this, k -> R.interfaceInstance(this, ${className}.class, ${wrapperClassName}.class));\n` +
    `    }\n` +
    `}`
  ).replace(/\n *\n+/g, "\n\n").replace(/\n+( *})/g, "\n$1");
}

while (classes.length) {
  processClass(classes.shift());
}
while (additionalClasses.length) {
  processClass(additionalClasses.shift());
}

const genRoot = outputDir + "/dev/gxlg/versiont/gen";
if (fs.existsSync(genRoot)) {
  fs.rmSync(genRoot, { "recursive": true });
}
fs.mkdirSync(genRoot, { "recursive": true });
for (const fullyQualified in processedClasses) {
  let content = processedClasses[fullyQualified];
  if (content.includes("%subclasses%")) {
    const subclasses = classesInheritance[fullyQualified] ?? [];
    content = content.replace("%subclasses%", subclasses.map(c => c + ".class").join(", "));
  }
  const fileName = fullyQualified.replace("dev.gxlg.versiont.gen.", "").replaceAll(".", "/") + ".java";
  const folder = fileName.split("/").slice(0, -1).join("/");
  fs.mkdirSync(genRoot + "/" + folder, { "recursive": true });
  fs.writeFileSync(genRoot + "/" + fileName, content);
  console.log("Generated", fullyQualified);
}
console.log("Version't layer generated!");
