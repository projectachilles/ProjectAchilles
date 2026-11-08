# Seeds the local Elasticsearch with synthetic results (docker compose
# --profile elasticsearch). The client is installed here, at build time, so a
# first `up` needs no PyPI access. The seed scripts are mounted from ./scripts.
FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
RUN pip install --no-cache-dir 'elasticsearch==8.17.2'
