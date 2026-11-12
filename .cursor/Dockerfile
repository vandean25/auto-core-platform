FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Node.js version must stay in sync with repo root .nvmrc (installed via nvm, exposed on PATH).
ARG NVM_VERSION=0.40.3
ARG NODE_VERSION=24.22.3

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates curl git xz-utils build-essential python3 \
    gnupg lsb-release sudo \
  && rm -rf /var/lib/apt/lists/*

RUN install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends \
    postgresql-17 postgresql-client-17 libpq-dev \
  && rm -rf /var/lib/apt/lists/*

USER ubuntu
RUN curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/v${NVM_VERSION}/install.sh" | bash \
  && export NVM_DIR="$HOME/.nvm" \
  && . "$NVM_DIR/nvm.sh" \
  && nvm install "${NODE_VERSION}" \
  && nvm alias default "${NODE_VERSION}" \
  && nvm use default \
  && node -v \
  && npm -v

USER root
ARG NODE_VERSION=24.22.3
RUN ln -sf "/home/ubuntu/.nvm/versions/node/v${NODE_VERSION}/bin/node" /usr/local/bin/node \
  && ln -sf "/home/ubuntu/.nvm/versions/node/v${NODE_VERSION}/bin/npm" /usr/local/bin/npm \
  && ln -sf "/home/ubuntu/.nvm/versions/node/v${NODE_VERSION}/bin/npx" /usr/local/bin/npx \
  && ln -sf "/home/ubuntu/.nvm/versions/node/v${NODE_VERSION}/bin/corepack" /usr/local/bin/corepack \
  && node -v

USER ubuntu
