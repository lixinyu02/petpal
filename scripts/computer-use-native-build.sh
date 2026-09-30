#!/usr/bin/env bash
set -euo pipefail
# Build only inside an isolated Ubuntu 22.04 container; never install host tools.
source_root="$(realpath "${1:?Usage: computer-use-native-build.sh SOURCE_ROOT NEW_OUTPUT_ROOT [x64|arm64]}")"
output_root="$(realpath -m "${2:?A new output directory is required}")"
native_arch="${3:-x64}"
[[ "$native_arch" == x64 || "$native_arch" == arm64 ]] || { echo 'Unsupported native architecture' >&2; exit 1; }
image_tag="petpal-computer-native-jammy-$native_arch:rust-1.90.0"
source_commit=cfbb6af0e704da17c43df6c668225a2f84aca762
patch_file="$(cd "$(dirname "${BASH_SOURCE[0]}")/../server/native/computer-use/patches" && pwd)/linux-x11-window-geometry.patch"
patch_sha=ad05d1b466c94d2ca90f009630ece9d8dcc0d52aa2b571a09a974d4b6f51ad71
[[ "$(sha256sum "$patch_file" | cut -d' ' -f1)" == "$patch_sha" ]] || { echo 'Controlled native patch hash mismatch' >&2; exit 1; }
[[ "$(git -C "$source_root" rev-parse HEAD)" == "$source_commit" ]] || { echo 'Source commit does not match pinned Zavora source' >&2; exit 1; }
# A Windows checkout has CRLF from core.autocrlf; validate the same Git clean
# filter without changing that checkout or global WSL configuration.
[[ -z "$(git -c core.autocrlf=true -C "$source_root" status --porcelain --untracked-files=no)" ]] || { echo 'Pinned source has tracked modifications' >&2; exit 1; }
[[ ! -e "$output_root" ]] || { echo 'Output directory must be new' >&2; exit 1; }
[[ "$output_root" != "$source_root" && "$output_root" != "$source_root/"* ]] || { echo 'Output must not be inside frozen source' >&2; exit 1; }
mkdir -p "$output_root"
cp "$patch_file" "$output_root/linux-x11-window-geometry.patch"
git -C "$source_root" ls-files -z native > "$output_root/source-files.list"
while IFS= read -r -d '' member; do (cd "$source_root" && sha256sum "$member"); done < "$output_root/source-files.list" > "$output_root/source.sha256"
printf '%s\n' "$source_commit" > "$output_root/source-commit.txt"
cat > "$output_root/Dockerfile" <<'DOCKERFILE'
FROM docker.m.daocloud.io/library/ubuntu@sha256:b8b6ee6aa931ecd9d0d952abc34dc0e5f7c6a30c6bb71b079fe399fde0329c02
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl build-essential pkg-config libx11-dev libxtst-dev libxrandr-dev libxi-dev xvfb xauth xdotool wmctrl imagemagick scrot openbox python3 python3-tk python3-gi python3-pyatspi gir1.2-gtk-3.0 dbus-x11 at-spi2-core && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL --retry 2 --max-time 600 https://static.rust-lang.org/dist/rust-1.90.0-x86_64-unknown-linux-gnu.tar.xz -o /tmp/rust.tar.xz && curl -fsSL --retry 2 --max-time 60 https://static.rust-lang.org/dist/rust-1.90.0-x86_64-unknown-linux-gnu.tar.xz.sha256 -o /tmp/rust.sha256 && printf '%s  /tmp/rust.tar.xz\n' "$(cut -d' ' -f1 /tmp/rust.sha256)" | sha256sum -c - && tar -xJf /tmp/rust.tar.xz -C /tmp && /tmp/rust-1.90.0-x86_64-unknown-linux-gnu/install.sh --prefix=/opt/rust --components=rustc,cargo,rust-std-x86_64-unknown-linux-gnu --without=rust-docs && rm -rf /tmp/rust-1.90.0-x86_64-unknown-linux-gnu /tmp/rust.tar.xz
RUN curl -fsSL --retry 2 --max-time 300 https://nodejs.org/dist/v22.16.0/node-v22.16.0-linux-x64.tar.xz -o /tmp/node.tar.xz && curl -fsSL --retry 2 --max-time 60 https://nodejs.org/dist/v22.16.0/SHASUMS256.txt -o /tmp/node.shasums && grep ' node-v22.16.0-linux-x64.tar.xz$' /tmp/node.shasums | sed 's#node-v22.16.0-linux-x64.tar.xz#/tmp/node.tar.xz#' | sha256sum -c - && mkdir /opt/node && tar -xJf /tmp/node.tar.xz --strip-components=1 -C /opt/node && rm /tmp/node.tar.xz
ENV PATH=/opt/rust/bin:/opt/node/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
WORKDIR /build
DOCKERFILE
if [[ "$native_arch" == arm64 ]]; then
cat >> "$output_root/Dockerfile" <<'ARM64_DOCKERFILE'
RUN sed -i 's/^deb /deb [arch=amd64] /' /etc/apt/sources.list && dpkg --add-architecture arm64 && printf '%s\n' 'deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports jammy main universe' 'deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports jammy-updates main universe' 'deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports jammy-security main universe' > /etc/apt/sources.list.d/arm64.list && apt-get update && apt-get install -y --no-install-recommends gcc-aarch64-linux-gnu libc6-dev-arm64-cross libx11-dev:arm64 libxtst-dev:arm64 libxrandr-dev:arm64 libxi-dev:arm64 && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL --retry 2 --max-time 300 https://static.rust-lang.org/dist/rust-std-1.90.0-aarch64-unknown-linux-gnu.tar.xz -o /tmp/rust-std.tar.xz && curl -fsSL --retry 2 --max-time 60 https://static.rust-lang.org/dist/rust-std-1.90.0-aarch64-unknown-linux-gnu.tar.xz.sha256 -o /tmp/rust-std.sha256 && printf '%s  /tmp/rust-std.tar.xz\n' "$(cut -d' ' -f1 /tmp/rust-std.sha256)" | sha256sum -c - && tar -xJf /tmp/rust-std.tar.xz -C /tmp && /tmp/rust-std-1.90.0-aarch64-unknown-linux-gnu/install.sh --prefix=/opt/rust --without=rust-docs && rm -rf /tmp/rust-std-1.90.0-aarch64-unknown-linux-gnu /tmp/rust-std.tar.xz
ARM64_DOCKERFILE
fi
cat > "$output_root/build-native.sh" <<'BUILD_NATIVE'
#!/usr/bin/env bash
set -euo pipefail
export PATH=/opt/rust/bin:/opt/node/bin:$PATH
# Use only the pinned tracked inventory. Recursive copying would also admit
# untracked/ignored Cargo configuration, build inputs or old target output.
tar -C /source --null --verbatim-files-from --no-recursion -cf - -T /output/source-files.list | tar -C /build -xf -
cd /build
LC_ALL=C sort -z /output/source-files.list > /output/source-inventory.expected.list
find native \( -type f -o -type l \) -print0 | LC_ALL=C sort -z > /output/source-inventory.copied.list
cmp /output/source-inventory.expected.list /output/source-inventory.copied.list
sha256sum -c /output/source.sha256
sed -i 's/\r$//' native/src/windows.rs
patch --batch --fuzz=0 -p1 < /output/linux-x11-window-geometry.patch
find native -type f ! -path '*/target/*' -print0 | sort -z | xargs -0 sha256sum > /output/patched-source.sha256
cd native
native="/output/computer-use-napi.linux-$NATIVE_ARCH.node"
if [[ "$NATIVE_ARCH" == arm64 ]]; then
  export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc PKG_CONFIG_ALLOW_CROSS=1 PKG_CONFIG_LIBDIR=/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/share/pkgconfig
  cargo build --locked --release --target aarch64-unknown-linux-gnu -j 4
  cp target/aarch64-unknown-linux-gnu/release/libcomputer_use_napi.so "$native"
  aarch64-linux-gnu-gcc --version > /output/cross-compiler.txt
  printf '%s\n' '{"crossCompiled":true,"runtimeVerified":false}' > /output/native-load.json
else
  cargo build --locked --release -j 4
  cp target/release/libcomputer_use_napi.so "$native"
  node -e 'const n=require(process.argv[1]);console.log(JSON.stringify({node:process.version,napi:process.versions.napi,exports:Object.keys(n).sort()}))' "$native" > /output/native-load.json
fi
rustc --version > /output/rust-version.txt
cargo --version > /output/cargo-version.txt
getconf GNU_LIBC_VERSION > /output/build-glibc.txt
readelf -d "$native" > /output/readelf-dynamic.txt
readelf --version-info "$native" > /output/readelf-versions.txt
sha256sum "$native" > /output/native.sha256
BUILD_NATIVE
docker build --progress=plain -t "$image_tag" "$output_root" > "$output_root/image-build.log" 2>&1
docker image inspect "$image_tag" --format '{{.Id}}' > "$output_root/container-image.txt"
docker run --rm --name "petpal-computer-native-build-$$" -e NATIVE_ARCH="$native_arch" --mount "type=bind,src=$source_root,dst=/source,readonly" --mount "type=bind,src=$output_root,dst=/output" "$image_tag" bash /output/build-native.sh > "$output_root/native-build.log" 2>&1
printf 'Native build completed: %s\n' "$output_root"
