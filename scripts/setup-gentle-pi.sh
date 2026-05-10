#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="${HOME}/.pi/agent"
PI_BIN_DIR="${AGENT_DIR}/bin"
PI_WRAPPER="${PI_BIN_DIR}/pi"
GENTLE_PI_CLI="${ROOT_DIR}/packages/coding-agent/dist/cli.js"
MCP_CONFIG="${ROOT_DIR}/.pi/mcp.json"
GLOBAL_MCP_CONFIG="${AGENT_DIR}/mcp.json"
GENTLE_PI_COMMAND="PATH=\"${PI_BIN_DIR}:\$PATH\" node \"${GENTLE_PI_CLI}\""

detect_shell_name() {
	local shell_path="${SHELL:-}"
	if [ -n "${shell_path}" ]; then
		basename "${shell_path}"
		return
	fi
	basename "${0}"
}

detect_arch() {
	case "$(uname -m)" in
		x86_64|amd64) echo "amd64" ;;
		arm64|aarch64) echo "arm64" ;;
		*) echo "unsupported" ;;
	esac
}

resolve_engram_tag() {
	if ! command -v curl >/dev/null 2>&1; then
		echo ""
		return
	fi
	curl -fsSL https://api.github.com/repos/Gentleman-Programming/engram/releases/latest 2>/dev/null \
		| grep '"tag_name"' | head -1 | cut -d'"' -f4
}

install_engram_macos() {
	if ! command -v brew >/dev/null 2>&1; then
		echo "Homebrew not found. Install from https://brew.sh and re-run, or grab a binary from https://github.com/Gentleman-Programming/engram/releases/latest"
		return 1
	fi
	brew tap Gentleman-Programming/homebrew-tap
	brew install engram
}

install_engram_linux() {
	local arch tag version asset url tmp
	arch="$(detect_arch)"
	if [ "${arch}" = "unsupported" ]; then
		echo "Unsupported Linux architecture: $(uname -m). Install engram manually from https://github.com/Gentleman-Programming/engram/releases"
		return 1
	fi
	tag="$(resolve_engram_tag)"
	if [ -z "${tag}" ]; then
		echo "Could not resolve latest engram release tag (curl missing or network error)."
		return 1
	fi
	version="${tag#v}"
	asset="engram_${version}_linux_${arch}.tar.gz"
	url="https://github.com/Gentleman-Programming/engram/releases/download/${tag}/${asset}"
	tmp="$(mktemp -d)"
	echo "Downloading ${asset}..."
	curl -fsSL "${url}" -o "${tmp}/engram.tar.gz"
	tar -xzf "${tmp}/engram.tar.gz" -C "${tmp}"
	mkdir -p "${HOME}/.local/bin"
	install -m 0755 "${tmp}/engram" "${HOME}/.local/bin/engram"
	rm -rf "${tmp}"
	echo "Installed engram to ${HOME}/.local/bin/engram"
	case ":${PATH}:" in
		*":${HOME}/.local/bin:"*) ;;
		*) echo "Note: add ${HOME}/.local/bin to PATH so 'engram' is on \$PATH." ;;
	esac
}

install_engram() {
	if command -v engram >/dev/null 2>&1 || [ -x "${HOME}/.local/bin/engram" ]; then
		echo "Engram CLI already installed."
		return 0
	fi
	case "$(uname -s)" in
		Darwin) install_engram_macos || echo "Engram install skipped." ;;
		Linux) install_engram_linux || echo "Engram install skipped." ;;
		MINGW*|MSYS*|CYGWIN*)
			echo "Windows detected. Run scripts/install-engram.ps1 from PowerShell to install engram."
			;;
		*)
			echo "Unsupported OS for engram auto-install: $(uname -s). See https://github.com/Gentleman-Programming/engram/releases"
			;;
	esac
}

rewrite_gentle_pi_alias() {
	local rc_file="$1"
	local new_line="$2"
	# Drop any previous gentle-pi alias (and its "# Gentle Pi" header) so re-running
	# this script picks up changes to GENTLE_PI_COMMAND instead of leaving a stale alias.
	if grep -qE '^(# Gentle Pi$|alias gentle-pi=)' "${rc_file}" 2>/dev/null; then
		sed -i.gentle-pi.bak -e '/^# Gentle Pi$/d' -e '/^alias gentle-pi=/d' "${rc_file}"
		rm -f "${rc_file}.gentle-pi.bak"
	fi
	printf '\n# Gentle Pi\n%s\n' "${new_line}" >>"${rc_file}"
}

install_shell_alias() {
	local shell_name="$1"
	case "${shell_name}" in
		fish)
			local fish_dir="${HOME}/.config/fish/functions"
			mkdir -p "${fish_dir}"
			cat >"${fish_dir}/gentle-pi.fish" <<EOF
function gentle-pi
    env PATH="${PI_BIN_DIR}:\$PATH" node "${GENTLE_PI_CLI}" \$argv
end
EOF
			echo "Installed fish function: ${fish_dir}/gentle-pi.fish"
			;;
		zsh)
			local rc_file="${HOME}/.zshrc"
			local line="alias gentle-pi='${GENTLE_PI_COMMAND}'"
			touch "${rc_file}"
			rewrite_gentle_pi_alias "${rc_file}" "${line}"
			echo "Installed zsh alias in ${rc_file}"
			;;
		bash)
			local rc_file="${HOME}/.bashrc"
			local line="alias gentle-pi='${GENTLE_PI_COMMAND}'"
			touch "${rc_file}"
			rewrite_gentle_pi_alias "${rc_file}" "${line}"
			echo "Installed bash alias in ${rc_file}"
			;;
		*)
			echo "Unknown shell '${shell_name}'. Skipping automatic alias install."
			return 1
			;;
	esac
}

echo "Setting up Gentle Pi in ${ROOT_DIR}"

cd "${ROOT_DIR}"

echo "Installing workspace dependencies..."
npm install

echo "Building Gentle Pi..."
npm run build

echo "Creating local pi wrapper for subagents..."
mkdir -p "${PI_BIN_DIR}"
rm -f "${PI_WRAPPER}"
cat >"${PI_WRAPPER}" <<EOF
#!/usr/bin/env bash
exec node "${GENTLE_PI_CLI}" "\$@"
EOF
chmod +x "${PI_WRAPPER}"

echo "Installing global MCP config to ${GLOBAL_MCP_CONFIG}..."
mkdir -p "${AGENT_DIR}"
install -m 0644 "${MCP_CONFIG}" "${GLOBAL_MCP_CONFIG}"

SHELL_NAME="$(detect_shell_name)"
echo "Detected shell: ${SHELL_NAME}"
install_shell_alias "${SHELL_NAME}" || true

echo "Warming Pi package resolution..."
PATH="${PI_BIN_DIR}:${PATH}" node "${GENTLE_PI_CLI}" --help >/dev/null

install_engram
if command -v engram >/dev/null 2>&1 || [ -x "${HOME}/.local/bin/engram" ]; then
	echo "Engram CLI ready. MCP config: ${GLOBAL_MCP_CONFIG}"
else
	echo "Warning: Engram CLI is not on PATH. Gentle Pi will run with degraded memory until Engram is installed."
fi

cat <<EOF

Gentle Pi is ready.

Run it now:
  gentle-pi

If your current terminal does not see the alias yet, reload your shell or run:

bash/zsh:
  source ~/.zshrc   # zsh
  source ~/.bashrc  # bash

fish:
  functions -e gentle-pi; source ~/.config/fish/functions/gentle-pi.fish

EOF

if [ "${GENTLE_PI_SKIP_LAUNCH:-0}" != "1" ]; then
	echo "Launching Gentle Pi..."
	exec env PATH="${PI_BIN_DIR}:${PATH}" node "${GENTLE_PI_CLI}"
fi
