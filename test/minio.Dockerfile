FROM golang:1.24.8-bookworm AS builder
RUN CGO_ENABLED=0 go install github.com/minio/minio@RELEASE.2025-10-15T17-29-55Z
FROM alpine:3.22
RUN apk add --no-cache ca-certificates && mkdir /data && chown 1000:1000 /data
COPY --from=builder /go/bin/minio /usr/local/bin/minio
USER 1000:1000
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
