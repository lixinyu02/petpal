// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 PetPal contributors. Original authoring client, 2026-10-01.
plugins {
  kotlin("jvm") version "2.4.10"
}
kotlin { jvmToolchain(21) }
val compilerClasspath = providers.gradleProperty("psd2liveClasspathFile").get()
val authoringBuildRoot = providers.gradleProperty("authoringBuildRoot").get()
layout.buildDirectory.set(file(authoringBuildRoot))
dependencies {
  implementation(files(file(compilerClasspath).readLines().filter(String::isNotBlank)))
}
