FROM golang:1.25-alpine AS builder
RUN apk add --no-cache git ca-certificates
ENV CGO_ENABLED=0
ENV GOPROXY=https://goproxy.io,direct
RUN go install github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z
FROM alpine:3.22
RUN apk add --no-cache ca-certificates && addgroup -g 10001 minio && adduser -D -u 10001 -G minio minio && mkdir /data && chown minio:minio /data
COPY --from=builder /go/bin/minio /usr/local/bin/minio
USER 10001:10001
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
HEALTHCHECK --interval=15s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1:9000/minio/health/live || exit 1
