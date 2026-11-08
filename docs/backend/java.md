---
title: "Spring Boot chunked upload backend example"
description: "A working Spring Boot 3 backend (Java 17, Maven, @RestController) for chunked, resumable and folder uploads, with manifest, chunk status and finalize endpoints and the multipart size limits."
---

# Java (Spring Boot) example

A minimal implementation of the [backend contract](/protocol) with Spring Boot 3, Java 17 or newer and Maven. It is a documentation example, not a shipped server: add authentication, check that an `uploadId` belongs to the current user, and limit sizes before using anything like it in production.

It was run against the real client (the built UI in Chromium) with the quick-start configuration: a nested folder with empty folders (through the manifest) and files of four and six chunks, compared with the source by SHA-256, a reload in the middle of a file followed by a resume through chunk status, a path with `..`, files over the size limits, a short chunk, a missing chunk at finalize, and a repeated finalize.

Create the project with the four files below, in these places, then run `mvn spring-boot:run` or `mvn package && java -jar target/upload-0.0.1-SNAPSHOT.jar`. The server listens on port 8080 unless you set `server.port`.

```text
pom.xml
src/main/resources/application.properties
src/main/java/com/example/upload/UploadApplication.java
src/main/java/com/example/upload/UploadController.java
```

## pom.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.5.16</version>
    <relativePath/>
  </parent>

  <groupId>com.example</groupId>
  <artifactId>upload</artifactId>
  <version>0.0.1-SNAPSHOT</version>

  <properties>
    <java.version>17</java.version>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
```

## application.properties

```properties
# One chunk is at most chunkSize (5 MiB in the quick start), so these are generous.
# Spring answers a part over max-file-size, or a request over max-request-size, with
# MaxUploadSizeExceededException, which the controller advice turns into 413 TOO_LARGE.
spring.servlet.multipart.max-file-size=64MB
spring.servlet.multipart.max-request-size=65MB
# Largest finished file accepted (checked against adTotalSize).
anydrop.max-file-size=10GB
# Tomcat reads and discards up to this much of a rejected body, so the browser sees the 413
# instead of a reset connection. Keep it at least as large as max-request-size.
server.tomcat.max-swallow-size=70MB
```

## UploadApplication.java

```java
package com.example.upload;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class UploadApplication {
    public static void main(String[] args) {
        SpringApplication.run(UploadApplication.class, args);
    }
}
```

## UploadController.java

```java
package com.example.upload;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import org.springframework.beans.TypeMismatchException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.util.FileSystemUtils;
import org.springframework.util.unit.DataSize;
import org.springframework.web.bind.ServletRequestBindingException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.MultipartFile;

@RestController
public class UploadController {
    private static final Path ROOT = Path.of("uploads").toAbsolutePath().normalize();
    private static final Path TMP = Path.of("uploads-tmp").toAbsolutePath().normalize();
    private static final Pattern UUID_RE = Pattern.compile("^[0-9a-f-]{36}$", Pattern.CASE_INSENSITIVE);
    private static final Pattern DRIVE_RE = Pattern.compile("^[A-Za-z]:");

    private final long maxFile;

    UploadController(@Value("${anydrop.max-file-size}") DataSize maxFile) {
        this.maxFile = maxFile.toBytes();
    }

    static class ApiException extends RuntimeException {
        final HttpStatus status;
        final String code;

        ApiException(HttpStatus status, String code, String message) {
            super(message);
            this.status = status;
            this.code = code;
        }
    }

    record FileEntry(String relativePath) {}

    record Manifest(List<String> folders, List<FileEntry> files) {}

    record Finalize(String uploadId, String relativePath, Long totalSize, Long totalChunks) {}

    /** The documented error body, { "code": "...", "message": "..." }, for every failure. */
    @RestControllerAdvice
    static class Errors {
        private static ResponseEntity<Map<String, String>> body(HttpStatus status, String code, String message) {
            return ResponseEntity.status(status).body(Map.of("code", code, "message", message));
        }

        @ExceptionHandler(ApiException.class)
        ResponseEntity<Map<String, String>> api(ApiException e) {
            return body(e.status, e.code, e.getMessage());
        }

        // Thrown when a part is over max-file-size or the request is over max-request-size.
        @ExceptionHandler(MaxUploadSizeExceededException.class)
        ResponseEntity<Map<String, String>> tooLarge(MaxUploadSizeExceededException e) {
            return body(HttpStatus.PAYLOAD_TOO_LARGE, "TOO_LARGE", "Request body is too large");
        }

        // A missing or non-numeric form field, or a request that is not multipart at all.
        @ExceptionHandler({MultipartException.class, TypeMismatchException.class, ServletRequestBindingException.class})
        ResponseEntity<Map<String, String>> badChunk(Exception e) {
            return body(HttpStatus.BAD_REQUEST, "INVALID_CHUNK", "Invalid chunk request");
        }

        @ExceptionHandler(HttpMessageNotReadableException.class)
        ResponseEntity<Map<String, String>> badJson(HttpMessageNotReadableException e) {
            return body(HttpStatus.BAD_REQUEST, "INVALID_PATH", "Invalid request");
        }
    }

    /** Absolute path inside ROOT for a client-supplied relative path, or null. */
    static Path target(String rel) {
        if (rel == null || rel.isEmpty() || rel.startsWith("/") || rel.contains("\\") || rel.indexOf('\0') >= 0
                || DRIVE_RE.matcher(rel).find()) {
            return null;
        }
        for (String segment : rel.split("/", -1)) {
            if (segment.isEmpty() || segment.equals(".") || segment.equals("..")) return null;
        }
        try {
            Path abs = ROOT.resolve(rel).normalize();
            return abs.startsWith(ROOT) && !abs.equals(ROOT) ? abs : null;
        } catch (InvalidPathException e) {
            return null;
        }
    }

    static Path mustTarget(String rel) {
        Path dest = target(rel);
        if (dest == null) throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PATH", "Invalid path");
        return dest;
    }

    static String mustUuid(String value) {
        if (value == null || !UUID_RE.matcher(value).matches()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CHUNK", "Invalid upload id");
        }
        return value;
    }

    /** Write to a temp name, then rename: a cut-off write never shows up as received. */
    static void writeAtomic(InputStream in, Path dest) throws IOException {
        Files.createDirectories(dest.getParent());
        Path part = dest.resolveSibling(dest.getFileName() + "." + UUID.randomUUID() + ".part");
        try {
            Files.copy(in, part);
            Files.move(part, dest, StandardCopyOption.ATOMIC_MOVE);
        } finally {
            Files.deleteIfExists(part);
        }
    }

    // Chunk upload, or a whole file. The same chunk may arrive twice: writing it again is harmless.
    @PostMapping("/upload")
    public Map<String, Object> chunk(
            @RequestParam(required = false) MultipartFile file,
            @RequestParam(required = false) String adUploadId,
            @RequestParam(required = false) Long adChunkIndex,
            @RequestParam(required = false) Long adChunkCount,
            @RequestParam(required = false) Long adChunkSize,
            @RequestParam(required = false) Long adChunkOffset,
            @RequestParam(required = false) Long adTotalSize,
            @RequestParam(required = false) String adRelativePath) throws IOException {
        if (file == null) throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CHUNK", "Missing file");

        // Not chunked (a file of at most chunkSize, or chunking is off): no chunk fields, write the file in place.
        if (adUploadId == null) {
            try (InputStream in = file.getInputStream()) {
                writeAtomic(in, mustTarget(adRelativePath));
            }
            return Map.of("ok", true);
        }

        mustUuid(adUploadId);
        if (adChunkIndex == null || adChunkCount == null || adChunkSize == null || adChunkOffset == null
                || adTotalSize == null || adChunkIndex < 0 || adChunkIndex >= Math.max(adChunkCount, 1)
                || adChunkSize < 0 || adChunkOffset < 0 || adTotalSize < 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CHUNK", "Invalid chunk request");
        }
        if (adTotalSize > maxFile) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "TOO_LARGE", "File is too large");
        }
        if (file.getSize() != Math.min(adChunkSize, adTotalSize - adChunkOffset)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CHUNK", "Chunk length does not match");
        }
        try (InputStream in = file.getInputStream()) {
            writeAtomic(in, TMP.resolve(adUploadId).resolve(String.valueOf(adChunkIndex)));
        }
        return Map.of("ok", true);
    }

    // Chunk status, used to resume.
    @GetMapping("/upload/status")
    public Map<String, Object> status(@RequestParam(defaultValue = "") String uploadId) throws IOException {
        if (!UUID_RE.matcher(uploadId).matches()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "HTTP_ERROR", "Unknown upload");
        }
        Path dir = TMP.resolve(uploadId);
        if (Files.exists(dir.resolve("done"))) return Map.of("received", List.of(), "complete", true);
        if (!Files.isDirectory(dir)) throw new ApiException(HttpStatus.NOT_FOUND, "HTTP_ERROR", "Unknown upload");
        try (Stream<Path> names = Files.list(dir)) {
            List<Long> received = names.map(p -> p.getFileName().toString())
                    .filter(n -> n.matches("\\d+"))
                    .map(Long::valueOf)
                    .sorted()
                    .toList();
            return Map.of("received", received);
        }
    }

    // Folder manifest: create every folder, including the empty ones.
    @PostMapping("/upload/manifest")
    public Map<String, Object> manifest(@RequestBody Manifest manifest) throws IOException {
        List<String> folders = manifest.folders() == null ? List.of() : manifest.folders();
        List<FileEntry> files = manifest.files() == null ? List.of() : manifest.files();
        List<Path> dirs = folders.stream().map(UploadController::mustTarget).toList();
        for (FileEntry f : files) { // reject a bad file path now, not at the first chunk
            mustTarget(f == null ? null : f.relativePath());
        }
        for (Path dir : dirs) Files.createDirectories(dir);
        return Map.of("ok", true);
    }

    // Finalize: assemble the chunks into the final file, then forget them. Idempotent.
    @PostMapping("/upload/finalize")
    public Map<String, Object> finalizeUpload(@RequestBody Finalize req) throws IOException {
        Path dest = mustTarget(req.relativePath());
        Path dir = TMP.resolve(mustUuid(req.uploadId()));
        if (Files.exists(dir.resolve("done"))) return Map.of("ok", true, "path", req.relativePath());
        if (req.totalSize() == null || req.totalChunks() == null || req.totalSize() < 0 || req.totalChunks() < 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CHUNK", "Invalid finalize request");
        }
        if (!Files.isDirectory(dir)) {
            throw new ApiException(HttpStatus.CONFLICT, "CHUNK_MISMATCH", "No chunks received");
        }

        Files.createDirectories(dest.getParent());
        Path part = dest.resolveSibling(dest.getFileName() + "." + UUID.randomUUID() + ".part");
        try {
            try (OutputStream out = Files.newOutputStream(part)) {
                for (long i = 0; i < req.totalChunks(); i++) {
                    Path chunk = dir.resolve(String.valueOf(i));
                    if (!Files.exists(chunk)) {
                        throw new ApiException(HttpStatus.CONFLICT, "CHUNK_MISMATCH", "Chunk " + i + " is missing");
                    }
                    Files.copy(chunk, out);
                }
            }
            if (Files.size(part) != req.totalSize()) {
                throw new ApiException(HttpStatus.CONFLICT, "CHUNK_MISMATCH", "Assembled size does not match");
            }
            Files.move(part, dest, StandardCopyOption.ATOMIC_MOVE); // atomic
        } finally {
            Files.deleteIfExists(part);
        }
        FileSystemUtils.deleteRecursively(dir);
        Files.createDirectories(dir);
        Files.writeString(dir.resolve("done"), req.relativePath(), StandardCharsets.UTF_8);
        return Map.of("ok", true, "path", req.relativePath());
    }

    // Optional: connectivityProbeUrl
    @RequestMapping(value = "/upload/ping", method = RequestMethod.HEAD)
    public ResponseEntity<Void> ping() {
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
```

## Size limits

Spring's multipart defaults are small: `spring.servlet.multipart.max-file-size` is `1MB` and `max-request-size` is `10MB`. A 5 MiB chunk (the quick-start `chunkSize`) would be refused, so set them above your chunk size, as the example does.

| Property | Meaning |
|---|---|
| `spring.servlet.multipart.max-file-size` | The largest single part, which is one chunk (or one whole file). Over it, Spring throws `MaxUploadSizeExceededException`, which the controller advice answers as `413 TOO_LARGE`. |
| `spring.servlet.multipart.max-request-size` | The largest multipart request. Keep it a little above `max-file-size`: the request also carries the `ad*` fields. |
| `anydrop.max-file-size` | The example's own property: the largest finished file, checked against `adTotalSize`. It answers `413 TOO_LARGE` too. |
| `server.tomcat.max-swallow-size` | How much of a rejected body Tomcat reads and discards. The default is 2 MB. When a body is larger than that, Tomcat closes the connection and the browser reports a network error instead of the `413` (the client showed `NETWORK` with the default, for a 3 MB body over a 2.5 MB limit). Keep it at least as large as `max-request-size`. |

The multipart properties do not apply to the JSON manifest, which a batch makes as large as its file count. Limit its size in the proxy in front of the app.

## Notes

- The `@RequestParam` names (`adUploadId`, ...) are read from the method parameters. `spring-boot-starter-parent` compiles with `-parameters`; without it, add `name = "adUploadId"` to each annotation.
- A missing or non-numeric form field, and a request that is not multipart, are answered as `400 INVALID_CHUNK` in the documented `{ "code", "message" }` shape. Unreadable JSON on the manifest and finalize endpoints is answered as `400 INVALID_PATH`.
- If the page and the API are on different origins, add a `WebMvcConfigurer` with `addCorsMappings` allowing the methods `GET`, `POST`, `HEAD` and `OPTIONS` and the headers `X-Requested-With`, `Cache-Control` and `Content-Type` (plus your own).
- `ApiException`, the records and the advice are nested in the controller only to keep the example in one file. Move them out in a real project.

See also the [Python (FastAPI) example](/backend/python), the [Express example](/backend/express), the [Laravel example](/backend/laravel) and the [protocol](/protocol).
