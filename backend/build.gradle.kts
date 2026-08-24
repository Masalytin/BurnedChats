plugins {
    id("java")
    id("org.springframework.boot") version "3.3.0"
    id("io.spring.dependency-management") version "1.1.4"
}

val lombokVersion: String by project
val mapstructVersion: String by project
val telegramBotsVersion: String by project
val testcontainersVersion: String by project
val springdocVersion: String by project

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

    // OpenAPI / Swagger UI (dev/testnet only — disabled in prod profile)
    implementation("org.springdoc:springdoc-openapi-starter-webmvc-ui:$springdocVersion")

    // Testing
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("io.projectreactor:reactor-test")
    testImplementation("org.testcontainers:junit-jupiter:$testcontainersVersion")
    testImplementation("org.testcontainers:testcontainers:$testcontainersVersion")
    testImplementation("com.squareup.okhttp3:mockwebserver:5.5.0")
    
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

val openApiOutput = rootProject.file("docs/specs/openapi.yaml")
val stompRoutesOutput = rootProject.file("docs/specs/stomp-routes.json")

tasks.register<JavaExec>("checkApiContracts") {
    group = "verification"
    description = "Fails when committed openapi.yaml or stomp-routes.json drift from code"
    dependsOn("classes")
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("dev.burnedchats.tools.ApiContractsDriftChecker")
    workingDir = rootProject.projectDir
    args(openApiOutput.absolutePath, stompRoutesOutput.absolutePath)
}

tasks.register<JavaExec>("exportOpenApi") {
    group = "documentation"
    description = "Exports REST OpenAPI spec to docs/specs/openapi.yaml"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("dev.burnedchats.tools.OpenApiExporter")
    workingDir = rootProject.projectDir
    args(openApiOutput.absolutePath)
}

tasks.register<JavaExec>("exportStompRoutes") {
    group = "documentation"
    description = "Exports STOMP route inventory to docs/specs/stomp-routes.json"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("dev.burnedchats.tools.StompRouteExporter")
    workingDir = rootProject.projectDir
    args(stompRoutesOutput.absolutePath)
}

