plugins {
    id("java")
    id("idea")
    id("checkstyle")
    id("com.github.spotbugs") version "6.0.7" apply false
}

allprojects {
    group = "dev.burnedchats"
    version = "0.1.7-SNAPSHOT"

    repositories {
        mavenCentral()
    }
}

subprojects {
    apply(plugin = "java")
    apply(plugin = "checkstyle")
    apply(plugin = "com.github.spotbugs")

    java {
        toolchain {
            languageVersion.set(JavaLanguageVersion.of(21))
        }
    }

    tasks.withType<JavaCompile> {
        options.encoding = "UTF-8"
        options.compilerArgs.addAll(listOf("-Xlint:all", "-Xlint:-processing"))
    }

    tasks.withType<Test> {
        useJUnitPlatform()
    }

    // Checkstyle configuration
    checkstyle {
        toolVersion = "10.12.5"
        configFile = rootProject.file("config/checkstyle/checkstyle.xml")
        isIgnoreFailures = false
        maxWarnings = 0
    }

    // SpotBugs configuration
    configure<com.github.spotbugs.snom.SpotBugsExtension> {
        ignoreFailures.set(false)
        showStackTraces.set(true)
        showProgress.set(true)
        excludeFilter.set(rootProject.file("config/spotbugs/exclude.xml"))
        reportLevel.set(com.github.spotbugs.snom.Confidence.MEDIUM)
    }

    tasks.withType<com.github.spotbugs.snom.SpotBugsTask> {
        reports.create("html") {
            required.set(true)
            outputLocation.set(layout.buildDirectory.file("reports/spotbugs/${name}.html"))
        }
        reports.create("xml") {
            required.set(false)
        }
    }
}

// Root project tasks
tasks.register("checkAll") {
    group = "verification"
    description =
        "Runs all checks (checkstyle, spotbugs, unit tests). " +
            "Docker IT: ./gradlew :backend:integrationTest"
    dependsOn(subprojects.map { "${it.path}:check" })
}

