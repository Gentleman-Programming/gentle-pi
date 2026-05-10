#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_BIN_DIR="${HOME}/.pi/agent/bin"
PI_WRAPPER="${PI_BIN_DIR}/pi"
GENTLE_PI_CLI="${ROOT_DIR}/packages/coding-agent/dist/cli.js"
MCP_CONFIG="${ROOT_DIR}/.pi/mcp.json"
GENTLE_PI_COMMAND="PATH=\"${PI_BIN_DIR}:\$PATH\" node \"${GENTLE_PI_CLI}\" --mcp-config \"${MCP_CONFIG}\""

detect_shell_name() {
	local shell_path="${SHELL:-}"
	if [ -n "${shell_path}" ]; then
		basename "${shell_path}"
		return
	fi
	basename "${0}"
}

install_shell_alias() {
	local shell_name="$1"
	case "${shell_name}" in
		fish)
			local fish_dir="${HOME}/.config/fish/functions"
			mkdir -p "${fish_dir}"
			cat >"${fish_dir}/gentle-pi.fish" <<EOF
function gentle-pi
    env PATH="${PI_BIN_DIR}:\$PATH" node "${GENTLE_PI_CLI}" --mcp-config "${MCP_CONFIG}" \$argv
end
EOF
			echo "Installed fish function: ${fish_dir}/gentle-pi.fish"
			;;
		zsh)
			local rc_file="${HOME}/.zshrc"
			local line="alias gentle-pi='${GENTLE_PI_COMMAND}'"
			touch "${rc_file}"
			grep -F "${GENTLE_PI_CLI}" "${rc_file}" >/dev/null 2>&1 || printf '\n# Gentle Pi\n%s\n' "${line}" >>"${rc_file}"
			echo "Installed zsh alias in ${rc_file}"
			;;
		bash)
			local rc_file="${HOME}/.bashrc"
			local line="alias gentle-pi='${GENTLE_PI_COMMAND}'"
			touch "${rc_file}"
			grep -F "${GENTLE_PI_CLI}" "${rc_file}" >/dev/null 2>&1 || printf '\n# Gentle Pi\n%s\n' "${line}" >>"${rc_file}"
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

SHELL_NAME="$(detect_shell_name)"
echo "Detected shell: ${SHELL_NAME}"
install_shell_alias "${SHELL_NAME}" || true

echo "Warming Pi package resolution..."
PATH="${PI_BIN_DIR}:${PATH}" node "${GENTLE_PI_CLI}" --help >/dev/null

if command -v engram >/dev/null 2>&1 || [ -x "${HOME}/.local/bin/engram" ]; then
	echo "Engram CLI detected. MCP config: ${MCP_CONFIG}"
else
	echo "Warning: Engram CLI was not found. Gentle Pi will run with degraded memory until Engram is installed."
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
	exec env PATH="${PI_BIN_DIR}:${PATH}" node "${GENTLE_PI_CLI}" --mcp-config "${MCP_CONFIG}"
fi
