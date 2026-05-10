# Gentle Pi Agent Harnesses

Gentle Pi Agent no busca replicar Gentle AI como ecosistema genérico. La intención es construir **el agente definitivo hecho a medida para Pi**, usando los conceptos fuertes de Gentle AI como harnesses internos del runtime.

> Gentle AI no es prompt engineering. Es un sistema de harnesses que convierten agentes autónomos en agentes con autonomía controlada.

## Principio central

Un harness es una estructura alrededor del agente. No le saca poder: le da dirección, límites, memoria operacional y contratos verificables.

Para Gentle Pi Agent, esto significa:

- No crear un framework universal.
- No soportar todos los runtimes posibles.
- No vender “prompts largos” como arquitectura.
- Sí construir un agente especializado, opinado y controlado.

```txt
usuario
  ↓
gentle-pi-agent
  ↓
harness layer
  ↓
sub-agentes / fases / tools
  ↓
artefactos / verificación / entrega
```

## Bloques de harnesses

### 1. SDD Orchestrator Harness

El orquestador no ejecuta: coordina. Los sub-agentes ejecutan.

```txt
usuario
  ↓
gentle-orchestrator
  ↓
sub-agentes por fase
```

El objetivo es evitar que un único agente mezcle contexto, implemente de más o pierda foco.

> El orquestador no es el dev que codea. Es el tech lead que reparte trabajo y controla el proceso.

### 2. `sdd-init` Harness

Paso cero de calibración del proyecto.

Detecta:

- stack,
- tests,
- convenciones,
- artifact store,
- skill registry,
- contexto del proyecto.

```txt
sdd-init
  ↓
project context
  ↓
testing capabilities
  ↓
skill registry
  ↓
SDD listo para correr
```

> sdd-init es calibrar la máquina antes de cortar la pieza.

### 3. Phase DAG Harness

El agente no puede saltar fases arbitrariamente. El trabajo se mueve por un DAG explícito.

```txt
sdd-init
  ↓
explore → proposal → spec
                    ↘
                     design
                       ↓
                     tasks
                       ↓
                     apply
                       ↓
                     verify
                       ↓
                     archive
```

Contratos de entrada:

- `spec` necesita `proposal`.
- `tasks` necesita `spec + design`.
- `apply` necesita `tasks + spec + design`.
- `verify` necesita `spec + tasks + apply-progress`.

### 4. Artifact Store Harness

El contexto no queda flotando en el chat. Cada fase produce artefactos recuperables.

Modos conceptuales:

- **Engram**: memoria persistente.
- **OpenSpec**: archivos versionables.
- **Hybrid**: memoria + archivos.
- **None**: inline solamente.

Para Gentle Pi Agent, el artifact store debe ser una decisión interna del agente/ruta de ejecución, no una obligación de compatibilidad universal.

```txt
fase SDD
  ↓
produce artifact
  ↓
artifact store
  ↓
siguiente fase lo recupera
```

### 5. OpenSpec Harness

OpenSpec aporta la gramática base:

```txt
proposal
requirements/spec
design
tasks
```

Gentle Pi Agent puede usar esa gramática como inspiración, pero no necesita convertirse en implementación genérica de OpenSpec.

Gentle agrega encima:

- memoria,
- sub-agentes,
- Strict TDD,
- skill registry,
- review guard,
- model routing,
- artifact continuity,
- permisos,
- rollback.

> OpenSpec nos da la gramática. Gentle le pone runtime, memoria y control operacional.

### 6. Strict TDD Harness

Si el proyecto tiene testing capabilities detectadas, `apply` y `verify` deben recibir una política fuerte:

> Hay tests. Hay runner. No improvises. Seguís TDD.

```txt
sdd-init detecta tests
  ↓
strict_tdd: true
  ↓
sdd-apply recibe instrucción TDD
  ↓
sdd-verify audita evidencia
```

Esto evita el clásico “implementé todo, no corrí nada, confiá”. Acá hay contrato.

### 7. Skill Registry Harness

El agente no debería leer todas las skills completas cada vez. Eso es caro, ruidoso y torpe.

```txt
skill registry
  ↓
orquestador detecta skills relevantes
  ↓
digiere reglas
  ↓
inyecta Project Standards compactos
  ↓
sub-agente ejecuta con reglas precisas
```

> El orquestador funciona como un compilador de contexto: toma documentación grande y la convierte en instrucciones compactas para el agente correcto.

### 8. Sub-Agent Isolation Harness

Cada sub-agente corre con contexto aislado.

```txt
orchestrator context
  ↓
sdd-explore context aislado
sdd-spec context aislado
sdd-apply context aislado
sdd-verify context aislado
```

Esto evita contaminación de contexto. Cada agente recibe su plano, sus restricciones y su tarea.

> No metemos a todos los obreros en la misma habitación gritando. Cada uno recibe su plano y su tarea.

### 9. Result Contract Harness

Cada fase devuelve un envelope estable:

```txt
status
executive_summary
artifacts
next_recommended
risks
skill_resolution
```

El orquestador no depende de prosa vaga. Entre agentes no se pasa “texto random”: se pasan contratos.

### 10. Review Workload Harness

El sistema protege al reviewer.

Después de `sdd-tasks`, antes de `sdd-apply`, se evalúa:

- si supera 400 líneas,
- si conviene chained PR,
- si necesita decisión humana,
- si hay size exception.

```txt
sdd-tasks
  ↓
Review Workload Forecast
  ↓
riesgo bajo → apply
riesgo alto → preguntar / chain / excepción
```

> El sistema no solo cuida al agente. Cuida al humano que tiene que revisar después.

### 11. Delivery Strategy Harness

Cuando el cambio puede ser grande, el agente aplica política de entrega:

- `ask-on-risk`,
- `auto-chain`,
- `single-pr`,
- `exception-ok`.

Esto define si puede avanzar, si debe cortar en PRs chicos o si requiere aprobación.

> No dejamos que el agente genere un monstruo de PR y después le tire el problema al reviewer.

### 12. Chain Strategy Harness

Si hay que partir trabajo, el sistema define geometría de PRs:

- `stacked-to-main`,
- `feature-branch-chain`.

```txt
stacked-to-main:
PR1 → main
PR2 → main
PR3 → main

feature-branch-chain:
tracker branch
  ↑
PR1
  ↑
PR2
  ↑
PR3
```

> Hasta la forma de partir trabajo está dentro del harness.

### 13. Apply-Progress Harness

Cuando `sdd-apply` continúa trabajo anterior, no pisa progreso. Lo lee, lo mergea y guarda estado combinado.

```txt
apply-progress existe
  ↓
leer progreso anterior
  ↓
aplicar nuevo batch
  ↓
mergear
  ↓
guardar progreso actualizado
```

> El agente no tiene memoria emocional. Entonces le damos memoria operacional.

### 14. Model Routing Harness

El sistema puede usar modelos distintos por fase.

```txt
explore → modelo barato
design  → modelo fuerte
apply   → modelo rápido
verify  → modelo crítico
```

> No usás la misma herramienta para medir, cortar y pulir. Con modelos pasa lo mismo.

### 15. Permission/Security Harness

El agente necesita guardrails operacionales:

- bloquear comandos peligrosos,
- proteger secretos,
- pedir confirmación en acciones destructivas,
- controlar `git push`, `reset`, `rebase` y similares.

> El agente puede ayudarte, pero no debería tener las llaves del edificio sin guardias.

### 16. Backup/Rollback Harness

Antes de mutar configuración, el sistema saca backup y define rollback.

```txt
plan
  ↓
backup
  ↓
apply cambios
  ↓
si falla → rollback
```

Debe contemplar:

- compresión,
- deduplicación,
- poda de backups viejos,
- rollback explícito,
- reversión de pasos si algo falla.

> Hasta la instalación tiene harness. No tocamos configs sin red de seguridad.

## Los 5 bloques grandes

### Harness de contexto

- `sdd-init`
- Engram / memoria persistente
- OpenSpec / specs versionables
- artifact store

### Harness de proceso

- orchestrator
- phase DAG
- result contracts
- apply-progress

### Harness de calidad

- Strict TDD
- verify
- skill registry
- project standards

### Harness de entrega

- review workload guard
- delivery strategy
- chain strategy
- PR budget

### Harness de seguridad

- permissions
- MCP strategy
- backup
- rollback

## Dirección para Gentle Pi Agent

Gentle Pi Agent debe ser un agente especializado y opinado que incorpore estos harnesses como comportamiento nativo.

La meta no es construir “Gentle AI portable”. La meta es construir **Gentle AI hecho a medida para Pi Agent**:

- menos compatibilidad genérica,
- más control operacional,
- menos configuración expuesta,
- más defaults fuertes,
- menos prompt engineering,
- más runtime/harness engineering.

## Frase guía

> El futuro no es darle prompts más largos a la AI. El futuro es construir mejores harnesses alrededor de agentes poderosos. Porque un agente sin harness es velocidad sin dirección. Gentle Pi Agent es dirección.

## Identity + Memory Harness

El runtime normal de Gentle Pi inyecta identidad propia, no solo cuando corre una fase con `PI_GENTLE_PI_PHASE`.

Contrato:

- identidad: Gentle Pi, un harness específico para Pi/coding-agent;
- tono: directo, técnico, conciso;
- español: Rioplatense natural con voseo;
- rol: arquitecto senior/docente, conceptos antes que código;
- memoria: Engram primero solo si hay evidencia real de herramientas configuradas/callables.

Estados de memoria:

- `available`: hay herramientas Engram callables; el agente debe buscar/recordar cuando el usuario pregunta por trabajo pasado y guardar decisiones, bugs y descubrimientos no obvios.
- `configured`: hay señales de configuración, pero no herramientas callables; el agente no debe prometer persistencia usable.
- `unavailable`: la superficie de herramientas fue inspeccionada y no hay Engram; se trabaja con memoria degradada usando sesión y OpenSpec.
- `unknown`: todavía no hay evidencia suficiente; se comunica incertidumbre sin inventar capacidades.

Pi memory packages no reemplazan Engram por defecto. Solo pueden hacerlo si existe una decisión explícita posterior.

## Native SDD Subagent Harness

Los agentes y cadenas SDD viven en el proyecto:

- `.pi/agents/sdd-*.md`: una definición por fase SDD, con allowlist de herramientas y `inheritProjectContext: true`.
- `.pi/chains/*.chain.md`: flujos guardados de `pi-subagents` con frontmatter, secciones `## agent-name`, config por paso y tareas para planning, full lifecycle y apply/verify.
- `.pi/settings.json`: notas de paquetes instalados y recomendados.

Paquetes:

- `pi-subagents@0.24.0`: default para ejecutar agentes/cadenas SDD nativas.
- `pi-intercom@0.6.0`: recomendado para decisiones bloqueadas o coordinación con supervisor.
- `pi-mcp-adapter@2.5.4`: recomendado para exponer herramientas MCP directas cuando haga falta.

Regla clave: los agentes de fase no delegan a subagentes hijos. Solo el padre/orquestador controla `/run`, `/chain` y `/parallel`.
