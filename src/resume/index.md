---
layout: layouts/article.vto
---

# Resume

## Download

The latest copy of my resume is available for download as a PDF:

- [resume.en.pdf](https://dangreco-resume.s3.ca-central-1.amazonaws.com/production/resume.en.pdf)
  (PDF)
- [resume.en.pdf.asc](https://dangreco-resume.s3.ca-central-1.amazonaws.com/production/resume.en.pdf.asc)
  (GPG Signature)
- [checksums.txt](https://dangreco-resume.s3.ca-central-1.amazonaws.com/production/checksums.txt)
  (SHA256)

---

## Verify

You can verify the authenticity and integrity of the downloaded resume using the
GPG signature and SHA256 checksum provided.

### 1. GPG Signature Verification

Import my GPG public key:

```bash
curl https://github.com/dangreco.gpg | gpg --import
```

Then verify the signature:

```bash
gpg --verify resume.en.pdf.asc resume.en.pdf
```

### 2. SHA256 Checksum Verification

```bash
sha256sum -c checksums.txt
```
