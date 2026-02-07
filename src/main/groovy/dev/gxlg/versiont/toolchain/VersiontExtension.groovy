package dev.gxlg.versiont.toolchain

import org.gradle.api.file.RegularFileProperty

abstract class VersiontExtension {
    abstract RegularFileProperty getMapping()
}