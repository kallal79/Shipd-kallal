FROM public.ecr.aws/d3j8x8q7/olympus-base:latest

RUN groupadd -g 1000 model && useradd -u 1000 -g 1000 -m -s /bin/bash model

WORKDIR /app

# Copy repository files (already cloned at the base commit)
COPY . .

# Install dependencies deterministically using committed lockfile
RUN export NODE_ENV=development && npm ci --legacy-peer-deps

# Pre-build lib from src at image build time as root so it exists for all users
RUN ./node_modules/.bin/babel --config-file ./.lib.babelrc src --out-dir lib

# Install the reporter in an isolated directory to avoid modifying project lockfile
RUN mkdir -p /reporter && cd /reporter && npm install mocha-junit-reporter@2.2.1
ENV NODE_PATH="/app/node_modules:/reporter/node_modules"

# Ensure universal permissions for any non-root user (including uid 1000 model and uid 4242 eval)
RUN mkdir -p /var/artifacts /tmp && chmod -R 777 /app /reporter /tmp /var/artifacts

USER model
CMD ["/bin/bash"]
