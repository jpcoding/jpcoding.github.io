---
title: "VS Code Remote SSH into an Apptainer Instance on HPC"
date: 2026-03-06
permalink: /posts/2026-03-06-adb-ssh-to-singularity/
tags:
  - Container
  - VSCode
  - SSH
  - HPC
---

If your cluster login environment is too old for the current VS Code server, but you are allowed to run Apptainer or Singularity on compute nodes, you can move the editor target into a newer container without touching the host OS. In my case, I specifically wanted a container with CUDA and a newer userspace, including a newer `glibc`, so GPU debugging and interactive inspection would work cleanly. This post shows a practical way to do that by running `sshd` inside the container and reaching it through the normal SSH jump path.

## Background

This is useful on clusters where the host userspace is effectively frozen, for example older enterprise Linux images or nodes with outdated `glibc`. VS Code Remote SSH may fail on the host even though the compute environment itself is perfectly usable. Installing a newer runtime directly on the host is usually fragile, and VS Code tunnel may not be something you want to rely on in a shared HPC environment.

The workaround is simple: launch a container on the compute node, run `sshd` inside it, and let VS Code connect to that container instead of the host.

## The Solution Stack

The connection path looks like this:

```
Laptop
  ↓
Login node
  ↓
Allocated compute node
  ↓
Apptainer/Singularity instance
  ↓
sshd inside the container
```

## Prerequisites

- You can already SSH from your laptop to the cluster login node.
- You have an interactive allocation on a compute node.
- The cluster allows Apptainer or Singularity instances.
- Your home directory is visible inside the container so `~/.ssh/authorized_keys` can be reused.
- `openssh-server` is available in the container image.

### Step 1: Build an image with `sshd`

Start from a Rocky 9 CUDA base and bake `sshd` into the image so the instance can accept SSH connections directly. The definition below is only an example, not a required template. The main point is to prepare an image that has the newer userspace you need for debugging, plus CUDA if you are debugging GPU workloads.

```text
Bootstrap: docker
From: nvidia/cuda:12.2.0-devel-rockylinux9

%post
  set -e
  dnf -y update
  dnf -y install curl --allowerasing 'dnf-command(config-manager)'
  dnf config-manager --set-enabled crb
  dnf -y install epel-release
  dnf -y groupinstall "Development Tools"
  dnf -y install gcc gcc-c++ make cmake wget curl which vim git tmux htop btop \
    python3 python3-devel python3-pip openssh-server openssh-clients
  python3 -m pip install --upgrade pip
  ssh-keygen -A
  dnf clean all && rm -rf /var/cache/dnf
  nvcc --version

%environment
  export PATH=/usr/local/cuda/bin:$PATH
  export LD_LIBRARY_PATH=/usr/local/cuda/lib64:$LD_LIBRARY_PATH
  export APPTAINER_SSHD_PORT=${APPTAINER_SSHD_PORT:-2222}

%startscript
  /usr/sbin/sshd -D \
    -p ${APPTAINER_SSHD_PORT:-2222} \
    -o PidFile=/tmp/sshd.pid \
    -o "AuthorizedKeysFile=$HOME/.ssh/authorized_keys" \
    -o StrictModes=no \
    -o UsePAM=no

%runscript
  exec /bin/bash "$@"
```

In practice, prepare this definition file and build the image on your laptop or another machine where you have `sudo` access:

```bash
sudo apptainer build rocky9_ssh.sif rocky9_ssh.def
```

If your site still exposes `singularity` instead of `apptainer`, the definition file stays the same, and the build command becomes `sudo singularity build rocky9_ssh.sif rocky9_ssh.def`.

### Step 2: Start the instance on the compute node

The image already knows how to start `sshd`, so the launcher only needs to start the instance, pass the port, and verify the listener.

```bash
#!/bin/bash
# start_rocky.sh - Start a Rocky Linux instance with baked-in SSHD
# Usage: ./start_rocky.sh [port] [instance_name] [image_path]

set -euo pipefail

INSTANCE_NAME=${2:-rockynv}
SSHD_PORT=${1:-2222}
SIF=${3:-${SIF_IMAGE:-$PWD/rocky9_ssh.sif}}
COMPUTE_NODE=$(hostname -s)

if command -v apptainer >/dev/null 2>&1; then
  CTR=apptainer
elif command -v singularity >/dev/null 2>&1; then
  CTR=singularity
else
  echo "ERROR: neither apptainer nor singularity was found in PATH"
  exit 1
fi

if [ ! -f "$SIF" ]; then
  echo "ERROR: container image not found: $SIF"
  echo "Pass the image path as arg 3 or set SIF_IMAGE before running this script."
  exit 1
fi

find_lib() {
  local name=$1
  local path
  path=$(ldconfig -p 2>/dev/null | grep "$name" | awk '{print $NF}' | head -1)
  if [ -z "$path" ]; then
    path=$(find /usr/lib64 /usr/lib /usr/local/lib64 -name "${name}*" 2>/dev/null | head -1)
  fi
  echo "$path"
}

LIBCUDA=$(find_lib "libcuda.so")
LIBNVML=$(find_lib "libnvidia-ml.so")

echo "==> Instance  : $INSTANCE_NAME"
echo "==> Compute   : $COMPUTE_NODE"
echo "==> Runtime   : $CTR"
echo "==> SSHD port : $SSHD_PORT"
echo "==> Image     : $SIF"
echo "==> libcuda   : ${LIBCUDA:-not found}"
echo "==> libnvml   : ${LIBNVML:-not found}"

if $CTR instance list 2>/dev/null | grep -q "^${INSTANCE_NAME} "; then
  echo "==> Stopping existing instance: $INSTANCE_NAME"
  $CTR instance stop "$INSTANCE_NAME"
  sleep 1
fi

BIND_ARGS=""
if [ -n "$LIBCUDA" ] && [ -f "$LIBCUDA" ]; then
  BIND_ARGS="$BIND_ARGS --bind ${LIBCUDA}"
fi
if [ -n "$LIBNVML" ] && [ -f "$LIBNVML" ]; then
  BIND_ARGS="$BIND_ARGS --bind ${LIBNVML}"
fi

echo "==> Starting instance..."
$CTR instance start --nv $BIND_ARGS \
  --env HOME="${HOME}" \
  --env SCRATCH="${SCRATCH:-}" \
  --env SHARE="${SHARE:-}" \
  --env PROJECT="${PROJECT:-}" \
  --env PSCRATCH="${PSCRATCH:-}" \
  --env APPTAINER_SSHD_PORT="${SSHD_PORT}" \
  "$SIF" "$INSTANCE_NAME"

sleep 2
if ss -tln 2>/dev/null | grep -q ":${SSHD_PORT}"; then
  echo "==> sshd is listening on port $SSHD_PORT"
  echo "==> Jump target: ${COMPUTE_NODE}"
else
  echo "ERROR: sshd does not appear to be listening on port $SSHD_PORT"
  echo "Check: $CTR exec instance://${INSTANCE_NAME} ps -ef | grep sshd"
  exit 1
fi
```

At this point, the compute node is acting like a temporary SSH jump target for the container.

### Step 3: Connect from your laptop

Replace `<login_node>` with your cluster login host, `<compute_node>` with the actual allocated node name from `hostname`, and `2222` with the port you passed to the startup script.

```bash
ssh -J <login_node>,<compute_node> -p 2222 YOUR_USERNAME@localhost
```

For VS Code Remote SSH, adding a dedicated host entry is more convenient:

```ssh-config
Host rocky-container
    HostName localhost
    Port 2222
    User YOUR_USERNAME
    ProxyJump <login_node>,<compute_node>
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
```

Once that is in place, VS Code can attach to `rocky-container` as if it were any other SSH host.

## Why this is useful

This setup is worth keeping around if you hit any of these cases:

- The cluster host OS is too old for the current VS Code server.
- You need a newer compiler, Python, CUDA userspace, or glibc than the host provides.
- You want to keep your development stack isolated from the shared node environment.
- You want the convenience of Remote SSH without asking the cluster admins to change the base image.

It is not meant to replace batch jobs or a proper site-supported development workflow. It is mainly a pragmatic escape hatch for debugging, interactive editing, and one-off investigations.

## Gotchas

- `StrictModes no` is often necessary on shared filesystems where home directory permissions do not look like a normal standalone Linux box.
- If your site rewrites `$HOME`, `$PROJECT`, or scratch paths in shell startup files, test the container environment with a plain SSH session first.
- Some clusters disable direct compute-node SSH except through the login node, so `ProxyJump` is the important part of the setup.
- If the image is shared broadly, baking host keys into `%post` is not ideal. For a personal development image, it is usually acceptable.
- If your site uses a nondefault SSH port, keep the script argument, the direct `ssh` command, and the SSH config entry in sync.

## Closing note

I would trust the `%startscript` design over a second ad hoc runtime wrapper. It is simpler, easier to reason about, and matches how container instances are supposed to be started. The only thing I still verify manually is whether the port is actually listening, because cluster networking and filesystem behavior vary more than the container itself.
