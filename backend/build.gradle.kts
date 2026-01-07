plugins {
    id("java")
    id("org.springframework.boot") version "3.3.0"
    id("io.spring.dependency-management") version "1.1.4"
}

val lombokVersion: String by project
val mapstructVersion: String by project
val telegramBotsVersion: String by project
val testcontainersVersion: String by project

dependencies {
    // Spring Boot Starters
    // Using spring-boot-starter-web for STOMP WebSocket support (servlet-based)
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-websocket")
    // Reactive Redis client (works with both reactive and imperative)
    implementation("org.springframework.boot:spring-boot-starter-data-redis-reactive")
    implementation("org.springframework.boot:spring-boot-starter-validation")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    
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

    // Testing
    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("io.projectreactor:reactor-test")
    testImplementation("org.testcontainers:junit-jupiter:$testcontainersVersion")
    testImplementation("org.testcontainers:testcontainers:$testcontainersVersion")
    
    // SpotBugs annotations
    compileOnly("com.github.spotbugs:spotbugs-annotations:4.8.3")
}

tasks.bootJar {
    archiveFileName.set("burned-chats-backend.jar")
}

// Ensure Lombok and MapStruct work together
tasks.withType<JavaCompile> {
    options.compilerArgs.addAll(listOf(
        "-Amapstruct.defaultComponentModel=spring",
        "-Amapstruct.unmappedTargetPolicy=ERROR"
    ))
}

