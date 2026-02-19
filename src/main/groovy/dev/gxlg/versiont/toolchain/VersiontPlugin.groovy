package dev.gxlg.versiont.toolchain

import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.api.tasks.Exec

class VersiontPlugin implements Plugin<Project> {
    @Override
    void apply(Project project) {
        project.pluginManager.apply("java")
        project.pluginManager.apply("idea")

        def extension = project.extensions.create("versiont", VersiontExtension)

        project.repositories {
            maven {
                name = "gXLg Maven"
                url = "https://gxlg.github.io/maven-repo/"
            }
        }

        project.dependencies {
            implementation "net.bytebuddy:byte-buddy:1.18.4"
            modImplementation "dev.gxlg:versiont-library:0.0.4"
        }

        def generatedSourceDir = project.layout.buildDirectory.dir("generated/sources/versiont/java").get().asFile

        def generateTask = project.tasks.register("versiontLayer", Exec) {
            group = "generation"
            description = "Generates reflection layer from a mapping file using Node.js"

            // Get the bundled script from resources
            def scriptUrl = getClass().getResource("/scripts/generate-layer.js")
            def scriptFile = project.layout.buildDirectory.file("tmp/versiont/generate-layer.js").get().asFile

            doFirst {
                // Extract the bundled script to a temporary location
                scriptFile.parentFile.mkdirs()
                scriptFile.text = scriptUrl.text

                // Validate input file is set
                if (!extension.mapping.isPresent()) {
                    throw new IllegalStateException("File option 'mapping' must be configured in 'versiont' block")
                }

                // Ensure output directory exists
                generatedSourceDir.mkdirs()
            }

            inputs.file(extension.mapping)
            outputs.dir(generatedSourceDir)

            commandLine "node",
                    scriptFile.absolutePath,
                    extension.mapping.get().asFile.absolutePath,
                    generatedSourceDir.absolutePath
        }

        // Add generated source directory to source sets
        project.sourceSets {
            main {
                java {
                    srcDir generatedSourceDir
                }
            }
        }

        // Make compileJava depend on generation task
        project.afterEvaluate {
            project.tasks.named("compileJava") {
                dependsOn generateTask
            }
        }

        project.idea {
            module {
                generatedSourceDirs.add(generatedSourceDir)
            }
        }
    }
}