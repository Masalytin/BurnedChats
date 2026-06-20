plugins {
    id("java")
    id("org.springframework.boot") version "3.3.0"
    id("io.spring.dependency-management") version "1.1.4"
}

val lombokVersion: String by project
val mapstructVersion: String by project
val telegramBotsVersion: String by project
val testcontainersVersion: String by project

fun isDockerEngineAvailable(): Boolean {
    return try {
        val process = ProcessBuilder("docker", "info")
            .redirectError(ProcessBuilder.Redirect.DISCARD)
            .redirectOutput(ProcessBuilder.Redirect.DISCARD)
            .start()
        process.waitFor() == 0
    } catch (_: Exception) {
        false
    }
}

dependencies {
    // Spring Boot Starters
    // Using spring-boot-starter-web for STOMP WebSocket support (servlet-based)
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-websocket")
    // Reactive Redis client (works with both reactive and imperative)
    implementation("org.springframework.boot:spring-boot-starter-data-redis-reactive")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("io.micrometer:micrometer-registry-prometheus")
    // WebClient for TON Center HTTP API (coexists with spring-boot-starter-web)
    implementation("org.springframework.boot:spring-boot-starter-webflux")
    
    // Reactor for async operations
    implementation("io.projectreactor:reactor-core")
    
    // Connection pooling for Redis (required for Lettuce pooling)
    implementation("org.apache.commons:commons-pool2:2.12.0")

    // Telegram Bot
    implementation("org.telegram:telegrambots:$telegramBotsVersion")

    // Lombok
    compileOnly("org.projectlombok:lombok:$lombokVersion")
    annotationProcessor("org.projectlombok:lombok:$lombokVersion")

    // MapStruct
    implementation("org.mapstruct:mapstruct:$mapstructVersion")
    annotationProcessor("org.mapstruct:mapstruct-processor:$mapstructVersion")

    // Logging (included in spring-boot-starter but explicit for clarity)
    implementation("ch.qos.logback:logback-classic")

    // TON cell / BoC decoding (governance proposal payloads)
    implementation("org.ton.ton4j:cell:2.0.2")

    // Testing
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("io.projectreactor:reactor-test")
    testImplementation("org.testcontainers:junit-jupiter:$testcontainersVersion")
    testImplementation("org.testcontainers:testcontainers:$testcontainersVersion")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    
    // SpotBugs annotations
    compileOnly("com.github.spotbugs:spotbugs-annotations:4.8.3")
}

tasks.bootJar {
    archiveFileName.set("burned-chats-backend.jar")
}

// Unit/component tests — no Testcontainers (see IMP-AUDIT-32).
tasks.named<Test>("test") {
    useJUnitPlatform {
        excludeTags("integration")
    }
}

// Docker-backed integration tests — opt-in; requires Docker Engine (see IMP-AUDIT-32).
tasks.register<Test>("integrationTest") {
    description = "Runs @Tag(\"integration\") tests (Testcontainers). Requires Docker Engine."
    group = "verification"
    testClassesDirs = sourceSets["test"].output.classesDirs
    classpath = sourceSets["test"].runtimeClasspath
    useJUnitPlatform {
        includeTags("integration")
    }
    shouldRunAfter(tasks.named("test"))
    onlyIf("Docker Engine is required for integration tests") {
        isDockerEngineAvailable()
    }
}

// Ensure Lombok and MapStruct work together
tasks.withType<JavaCompile> {
    options.compilerArgs.addAll(listOf(
        "-Amapstruct.defaultComponentModel=spring",
        "-Amapstruct.unmappedTargetPolicy=ERROR"
    ))
}

