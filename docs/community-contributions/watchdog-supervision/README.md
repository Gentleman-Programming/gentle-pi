# Contribuciones a Gentle-Pi: supervisión y ejecución autónoma más resiliente

Este repositorio reúne un conjunto de mejoras experimentales desarrolladas durante el uso de Gentle-Pi en flujos reales de programación autónoma.

## Por qué empezamos este trabajo

El punto de partida fue un problema práctico observado durante ejecuciones autónomas prolongadas.

Un worker podía comenzar correctamente una tarea, utilizar herramientas y producir avances reales, pero también podía entrar en situaciones como:

- repetir las mismas búsquedas o lecturas;
- insistir sobre archivos inexistentes;
- repetir errores o estrategias que ya habían fallado;
- consumir contexto investigando cada vez más sin converger;
- continuar trabajando hasta agotar una parte importante de la ventana de contexto;
- llegar finalmente a una ejecución degradada o bloqueada sin disponer de un mecanismo externo que evaluase lo que estaba ocurriendo.

El problema no era simplemente que el modelo pudiera equivocarse. El problema era que **el mismo agente que estaba ejecutando la tarea era también el único que podía decidir si seguía teniendo sentido continuar con su estrategia**.

Para tareas autónomas largas necesitábamos separar esas dos responsabilidades.

Por ese motivo desarrollamos un **supervisor/watchdog externo al worker**.

Su función inicial era observar la ejecución en tiempo real y responder a tres preguntas:

1. **¿El worker está haciendo progreso real?**
2. **¿Está atrapado en un bucle o consumiendo recursos sin converger?**
3. **Si la estrategia actual ha fallado, puede recuperarse la tarea mediante un nuevo contexto y una estrategia diferente sin perder el trabajo útil ya realizado?**

La arquitectura básica pasó a ser:

```text
Objetivo del usuario
        │
        ▼
   Phase Router
        │
        ▼
 Worker efímero ───────────► herramientas / código / tests
        │
        │ telemetría
        ▼
 Supervisor / Watchdog
        │
        ├── continuar
        ├── recuperar / rerutar
        └── bloquear solo si no existe recuperación razonable
```

A partir de ese primer supervisor surgieron nuevos problemas más sutiles.

Al introducir supervisión asíncrona, recuperación entre contextos y persistencia mediante Engram descubrimos que el propio sistema de control necesitaba garantías adicionales:

- una revisión SOFT del watchdog podía adquirir demasiada autoridad;
- una decisión del supervisor podía quedar obsoleta mientras el worker seguía progresando;
- la evidencia de recuperación de una tarea podía contaminar otra;
- un contexto nuevo podía volver a descubrir información que ya había sido obtenida;
- persistir llamadas a herramientas no era suficiente: también había que conservar **qué hechos se habían aprendido**;
- el watchdog necesitaba conocer los resultados de herramientas exitosas, no únicamente los errores;
- un worker podía guardar correctamente el resultado de su fase en Engram y ser abortado antes de ejecutar el `phase_complete` obligatorio;
- algunas protecciones correctas funcionalmente producían demasiado ruido en los logs.

Este repositorio documenta la evolución desde aquel problema inicial hasta el sistema actual de supervisión, recuperación y continuidad.

El objetivo es **colaborar con el proyecto original de Gentle-Pi y con su comunidad**: presentar los modos de fallo que observamos, explicar por qué apareció cada modificación, aportar la implementación utilizada para resolverlos y proporcionar evidencias reales que permitan revisar cada cambio de manera independiente.

Este trabajo **no pretende sustituir Gentle-Pi**, crear un fork incompatible ni presentar nuestras decisiones como la única arquitectura válida.

La idea central que terminó guiando el trabajo es:

> **El modelo que ejecuta una tarea no debería ser el único responsable de decidir si su propia estrategia sigue siendo válida.**

Y, una vez añadido un supervisor:

> **Las decisiones probabilísticas del supervisor pueden orientar al worker, pero las acciones destructivas del controlador deben estar limitadas por comprobaciones de estado deterministas.**

---

# Gentle-Pi contributions: more resilient autonomous execution and supervision

This repository packages a set of experimental improvements developed while using Gentle-Pi in real autonomous coding workflows.

## Why we started this work

The starting point was a practical problem observed during long-running autonomous executions.

A worker could begin a task correctly, use tools and make real progress, but it could also fall into situations such as:

- repeating the same searches or reads;
- repeatedly looking for files that did not exist;
- retrying errors or strategies that had already failed;
- consuming increasing amounts of context without converging;
- continuing until a significant part of the context window had been exhausted;
- eventually reaching a degraded or blocked execution without an external mechanism capable of evaluating what was happening.

The problem was not simply that the model could make mistakes.

The deeper problem was that **the same agent executing the task was also the only agent deciding whether its current strategy was still worth pursuing**.

For long-running autonomous tasks, we needed to separate those responsibilities.

That led us to develop an **external supervisor/watchdog for the worker**.

Its original purpose was to observe execution in real time and answer three questions:

1. **Is the worker making real progress?**
2. **Is it trapped in a loop or consuming resources without converging?**
3. **If the current strategy has failed, can the task be recovered in a fresh context with a different strategy without losing useful work already completed?**

The basic architecture became:

```text
User objective
      │
      ▼
 Phase Router
      │
      ▼
Ephemeral worker ──────────► tools / code / tests
      │
      │ telemetry
      ▼
Supervisor / Watchdog
      │
      ├── continue
      ├── recover / reroute
      └── block only when reasonable recovery is unavailable
```

Once that first supervisor existed, more subtle problems became visible.

Introducing asynchronous supervision, cross-context recovery and Engram persistence meant that the controller itself required stronger guarantees:

- SOFT watchdog reviews could acquire too much authority;
- supervisor decisions could become stale while the worker continued making progress;
- recovery evidence from one task could contaminate another;
- a fresh context could rediscover information that had already been acquired;
- preserving tool activity was not enough: the system also needed to preserve **what had actually been learned**;
- the watchdog needed access to successful tool results, not only failures;
- a worker could successfully persist its phase result to Engram and still be aborted before the mandatory `phase_complete` call;
- some functionally correct protections produced excessive log noise.

This repository documents the evolution from that original problem to the current supervision, recovery and continuation system.

The goal is **to collaborate with the original Gentle-Pi project and its community**: describe the failure modes we observed, explain why each modification was introduced, provide the implementation used to address them, and share real validation evidence so that each change can be reviewed independently.

This work is **not intended to replace Gentle-Pi**, create an incompatible fork, or present our design choices as the only valid architecture.

The first principle that emerged from this work was:

> **The model executing a task should not be solely responsible for deciding whether its own strategy is still valid.**

And once an external supervisor was introduced:

> **Probabilistic supervisor decisions may guide the worker, but destructive controller actions should remain bounded by deterministic state checks.**

---

## Contenido / Contents

- `src/phase-router.ts` — versión actual del router utilizada en las pruebas.
- `ORIGIN_AND_EVOLUTION.md` — origen y evolución del sistema: de la reducción de contexto al watchdog activo (español e inglés).
- `MODEL_EVIDENCE_AND_LIMITS.md` — alcance verificable de las pruebas de modelos y límites de atribución (español e inglés).
- `docs/` — explicación del problema, arquitectura y cada grupo de cambios.
- `evidence/` — evidencia resumida y anonimizada de validación.
- `CHANGELOG.md` — inventario de los hardenings introducidos.
- `UPSTREAM-NOTES.md` — propuesta para dividir el trabajo en contribuciones revisables.
- `SECURITY-SANITIZATION.md` — comprobaciones realizadas antes de publicar.

## Proyecto upstream / Upstream project

Este trabajo está pensado para discusión y contribución hacia:

`https://github.com/Gentleman-Programming/gentle-pi`

Gentle-Pi se publica bajo licencia MIT. Antes de convertir estos cambios en PRs, deben compararse con la versión `main` actual y adaptarse a la estructura que prefiera el mantenedor.
