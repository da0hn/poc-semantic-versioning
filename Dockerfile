FROM maven:3.9.9-amazoncorretto-24-alpine AS build
MAINTAINER "gabriel honda"
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn -B package -DskipTests

FROM amazoncorretto:24-alpine3.18
COPY --from=build /app/target/*.jar /app.jar

LABEL maintainer="Gabriel Honda"

EXPOSE 8080
ENTRYPOINT ["java","-jar","/app.jar"]
