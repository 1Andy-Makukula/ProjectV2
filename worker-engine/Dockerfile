# Build Phase
FROM alpine:3.18 AS builder

RUN apk add --no-cache g++ make

WORKDIR /build

COPY main.cpp .

# Compile using -O3 optimization level and static linking for maximum portability and performance
RUN g++ -O3 -static -o worker_engine main.cpp

# Run Phase
FROM alpine:3.18

WORKDIR /app

COPY --from=builder /build/worker_engine .

ENTRYPOINT ["./worker_engine"]
