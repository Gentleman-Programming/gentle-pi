# gentle-pi

`gentle-pi` instala **el Gentleman** en Pi: un harness de desarrollo controlado para que el agente deje de ser un chat genérico y empiece a trabajar con disciplina de arquitectura, SDD/OpenSpec, subagentes, evidencia de TDD y cuidado real del reviewer.

La idea es simple: Pi ya tiene herramientas poderosas; `gentle-pi` agrega criterio operativo para usarlas bien.

## Instalación

```bash
pi install npm:gentle-pi
```

Paquetes compañeros recomendados:

```bash
pi install npm:pi-subagents
pi install npm:pi-intercom
```

Después iniciá Pi dentro de tu proyecto:

```bash
pi
```

En cada sesión, `gentle-pi` instala o refresca assets SDD del proyecto sin pisar cambios locales.

## Qué hacemos

`gentle-pi` configura Pi para trabajar como **el Gentleman**:

- piensa como arquitecto senior, no como chatbot;
- separa trabajo chico, trabajo delegable y trabajo que necesita SDD;
- usa artifacts de fase en vez de depender solo del contexto flotante del chat;
- coordina subagentes cuando conviene reducir contexto o revisar con independencia;
- protege el tamaño de los cambios para no quemar al reviewer;
- aplica política de seguridad contra comandos destructivos;
- deja comandos y UI para asignar modelos por agente.

## Hermosuras que agrega

| Hermosura | Qué aporta |
|---|---|
| Identidad el Gentleman | Responde como harness específico de Pi, con persona de arquitecto senior. En español usa voseo rioplatense. |
| Routing de trabajo | Trabajo chico queda inline; exploración pesada se delega; cambios grandes van por SDD/OpenSpec. |
| SDD/OpenSpec | Instala agentes y chains para `init`, `explore`, `proposal`, `spec`, `design`, `tasks`, `apply`, `verify` y `archive`. |
| Subagentes listos | Deja assets para que Pi pueda ejecutar fases con contexto enfocado. |
| Strict TDD | Incluye soporte para RED → GREEN → TRIANGULATE → REFACTOR cuando el proyecto declara TDD estricto. |
| Guard de review | Detecta riesgo de PRs grandes y empuja a dividir trabajo antes de saturar al reviewer. |
| Asignación de modelos | Modal para elegir modelos por agente: SDD primero, custom agents después. |
| Skills de delivery | Incluye skills para PRs, issues, commits por unidad, chained PRs, documentación cognitiva, comments y Judgment Day. |
| Prompts cortos | Agrega templates `/gcl`, `/gis`, `/gpr`, `/gwr` para flujos frecuentes. |
| Seguridad de shell | Bloquea comandos destructivos y pide confirmación para operaciones sensibles. |

## Comandos principales

```text
/gentle-ai:status          Muestra estado del paquete, assets SDD, OpenSpec y modelos.
/gentle:models             Abre el modal de asignación de modelos por agente.
/gentle:persona            Cambia entre persona gentleman y neutral.
/sdd-init                  Inicializa o refresca openspec/config.yaml.
/gentle-ai:install-sdd     Reinstala assets SDD sin pisar archivos existentes.
/gentle-ai:install-sdd --force
                           Fuerza el refresco de assets SDD instalados.
```

Aliases de compatibilidad:

```text
/gentle-ai:models
/gentleman:models
/gentle-ai:persona
/gentleman:persona
```

## Persona

La persona default es `gentleman`.

```text
/gentle:persona
```

Modos disponibles:

| Persona | Comportamiento |
|---|---|
| `gentleman` | Arquitecto senior, didáctico, directo, con español rioplatense/voseo cuando escribís en español. |
| `neutral` | Misma disciplina técnica, pero con tono profesional neutro y sin regionalismos. |

Config persistida en el proyecto:

```text
.pi/gentle-ai/persona.json
```

Después de cambiar la persona, corré `/reload` o abrí una nueva sesión para refrescar prompts ya inyectados.

## Modelos por agente

```text
/gentle:models
```

El modal descubre agentes en:

- `.pi/agents/` y `.agents/` del proyecto;
- `~/.pi/agent/agents/` y `~/.agents/` del usuario;
- agentes built-in de `pi-subagents`.

Los agentes SDD aparecen primero para que puedas asignar modelos fuertes donde más impactan.

Recomendación práctica:

| Tipo de agente | Modelo recomendado |
|---|---|
| Explore, proposal, archive | Rápido y barato suele alcanzar. |
| Spec, design, tasks | Modelo fuerte en razonamiento. |
| Apply | Modelo fuerte en coding y tool-use. |
| Verify / review | El modelo más fuerte que puedas costear; la independencia importa. |
| Utilitarios chicos | Heredar el modelo activo/default. |

Config persistida:

```text
.pi/gentle-ai/models.json
```

Aplicación de overrides:

```text
.pi/agents/*.md                 # agentes markdown del proyecto/usuario
.pi/settings.json               # overrides para agentes built-in de pi-subagents
```

## Archivos que instala en proyectos

`gentle-pi` copia assets locales al iniciar sesión:

```text
.pi/agents/sdd-*.md
.pi/chains/sdd-*.chain.md
.pi/gentle-ai/support/strict-tdd.md
.pi/gentle-ai/support/strict-tdd-verify.md
```

No pisa archivos existentes salvo que ejecutes:

```text
/gentle-ai:install-sdd --force
```

## Contenido del paquete

| Ruta | Propósito |
|---|---|
| `extensions/gentle-ai.ts` | Inyecta identidad, instala assets, registra comandos, aplica modelos y protege shell. |
| `extensions/sdd-init.ts` | Registra `/sdd-init` para inicialización OpenSpec. |
| `extensions/skill-registry.ts` | Mantiene `.atl/skill-registry.md` para reglas compactas por skill. |
| `assets/orchestrator.md` | Contrato de orquestación para la sesión padre. |
| `assets/agents/` | Agentes SDD copiados a `.pi/agents/`. |
| `assets/chains/` | Chains SDD copiadas a `.pi/chains/`. |
| `assets/support/` | Guías Strict TDD para apply/verify. |
| `skills/` | Skills de Gentle AI y delivery. |
| `prompts/` | Prompt templates Gentle-prefixed. |

## Skills incluidos

- `gentle-ai` — disciplina del harness el Gentleman.
- `branch-pr` — PRs con issue-first checks.
- `chained-pr` — división de cambios grandes en PRs encadenados.
- `work-unit-commits` — commits por unidad revisable.
- `judgment-day` — dual review adversarial y re-juicio.
- `cognitive-doc-design` — documentación que baja carga cognitiva.
- `comment-writer` — comentarios técnicos, cálidos y concisos.
- `issue-creation` — workflow de issues con checks previos.

## Memoria

Este paquete **no** configura memoria persistente por sí mismo.

Si querés memoria, instalá un paquete separado, por ejemplo:

```bash
pi install npm:gentle-engram
```

el Gentleman solo menciona memoria cuando una herramienta o paquete de memoria está realmente activo.

## Desarrollo local

Desde este repo:

```bash
pi install .
```

Validaciones útiles antes de publicar:

```bash
node --experimental-strip-types --check extensions/gentle-ai.ts
npm pack --dry-run
```

Publicación:

```bash
npm publish
```

## Principios

- Conceptos antes que código.
- Artifacts sobre contexto flotante.
- SDD cuando el riesgo lo justifica.
- TDD estricto cuando hay tests.
- Un orquestador padre, subagentes enfocados.
- Cambios revisables antes que PRs gigantes.
- Control humano por encima del momentum del agente.
