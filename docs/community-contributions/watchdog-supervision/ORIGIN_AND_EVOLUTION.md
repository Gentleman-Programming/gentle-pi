# Origen y evolución del sistema de supervisión

## Del contexto inicial a la supervisión activa

Este documento explica la secuencia que llevó al sistema de preflight y watchdog de esta contribución. Describe observaciones realizadas en un entorno local de desarrollo; no pretende establecer un benchmark universal de Pi, Gentle-Pi ni de ningún modelo.

### 1. La observación inicial: contexto ocupado antes de trabajar

Al enviar una petición trivial con los recursos opcionales cargados, observamos aproximadamente **25,3K tokens** de contexto ya ocupados antes de que comenzara trabajo útil. El valor incluía recursos disponibles en el arranque, como extensiones, skills, plantillas, temas, archivos de contexto y otras capacidades opcionales.

La observación no demostraba que todos esos recursos fueran innecesarios. Mostraba que cargar todo por adelantado imponía un coste considerable incluso en tareas que solo requerían una fracción de esas capacidades.

### 2. Reducción progresiva de la carga inicial

La respuesta inicial fue desactivar progresivamente recursos opcionales de la carga inicial y medir el resultado. Se fueron retirando extensiones, skills, plantillas, temas, archivos de contexto y otras capacidades no imprescindibles para un worker mínimo.

En esa configuración reducida, el contexto inicial quedó en aproximadamente **1,6K tokens**. La diferencia fue de alrededor de **23,7K tokens**, cerca del **94%** de la carga inicial observada.

Estas cifras son mediciones locales de una configuración concreta. Sirven para explicar el origen de la arquitectura; no deben interpretarse como una comparación generalizable entre instalaciones, versiones o modelos.

### 3. El problema que apareció al retirar herramientas

Reducir el contexto resolvió una parte importante del coste, pero introdujo una pregunta operativa: si el worker no recibía todas las herramientas al arrancar, ¿cómo podía disponer de la capacidad que sí necesitaba para una petición concreta?

Un conjunto fijo y mínimo podía dejar al worker sin lectura, búsqueda, edición, memoria, shell u otra capacidad necesaria. Volver a cargar todo anulaba el beneficio de la reducción. El sistema necesitaba decidir las capacidades por tarea, no por una lista global cargada siempre.

### 4. Nacimiento del preflight con Qwen

De esa necesidad nació un preflight basado en Qwen. Antes de iniciar el trabajo, Qwen inspecciona la petición y selecciona dinámicamente solo las herramientas y capacidades necesarias para la fase prevista. El worker recibe ese subconjunto en vez de un catálogo completo por defecto.

Así, Qwen empezó como un mecanismo de **enrutamiento de capacidades**: decidir qué se permitía ver y usar al worker para una tarea determinada.

### 5. De decidir capacidades a observar progreso

La evolución natural fue reutilizar ese análisis durante la ejecución. Si Qwen ya podía entender el objetivo, las capacidades necesarias y el plan de una fase, también podía recibir telemetría del worker —por ejemplo, llamadas a herramientas, resultados, intentos, cambios de estado y uso de contexto— para valorar si la actividad observada representaba progreso real.

Esto permitió distinguir entre actividad y avance: un worker puede seguir llamando herramientas sin acercarse al resultado, repetir una estrategia o entrar en una secuencia sin convergencia.

> **Qwen empezó como una forma de decidir qué debía poder ver el worker. Evolucionó hasta convertirse en una forma de decidir si el worker realmente estaba progresando.**

### 6. Nacimiento del watchdog activo

El preflight evolucionó así en un watchdog activo que combina la lectura de telemetría con decisiones de control acotadas:

- `continue`: la ejecución conserva evidencia de progreso y puede continuar;
- `abort_reroute`: la estrategia actual no converge de forma suficiente y la tarea debe recuperarse con un contexto o ruta diferente;
- `blocked`: no existe una recuperación razonable sin nueva información, capacidad o decisión externa.

El objetivo no es sustituir el juicio del worker en cada paso. Es aportar una evaluación externa que pueda detectar que seguir ejecutando la misma estrategia ya no está justificado.

### 7. Hardening posterior

La operación del watchdog reveló garantías adicionales necesarias para que su control no introdujera nuevos fallos. La evolución posterior incorporó, entre otras, las siguientes protecciones:

- **read-only inspection baseline**: la inspección inicial no modifica el estado del worker ni de la tarea;
- **meaningful-progress guard**: una decisión de intervención no invalida avances verificables que ocurrieron después de la observación;
- **semantic checkpoint/recovery**: se conservan los hechos y resultados útiles, no solo el historial de llamadas a herramientas, para que una recuperación no reinicie el aprendizaje;
- **successful-result evidence**: el supervisor puede considerar resultados exitosos, no únicamente errores o repeticiones;
- **termination grace**: se concede un margen controlado para completar pasos de cierre obligatorios antes de abortar;
- **task-identity fence**: la evidencia y los estados de recuperación quedan delimitados por identidad de tarea para evitar contaminación entre ejecuciones.

Estas medidas mantienen la misma idea de diseño: las evaluaciones probabilísticas pueden orientar la ejecución, pero las acciones de control con efectos destructivos deben respetar comprobaciones de estado deterministas y evidencia vinculada a la tarea correcta.

---

# Origin and evolution of the supervision system

## From initial context to active supervision

This document explains the sequence that led to the preflight and watchdog system in this contribution. It describes observations made in a local development environment; it is not intended as a universal benchmark for Pi, Gentle-Pi, or any model.

### 1. The initial observation: context already occupied before work

When a trivial request was sent with optional resources loaded, we observed approximately **25.3K tokens** of context already occupied before useful work began. That figure included startup-available resources such as extensions, skills, templates, themes, context files, and other optional capabilities.

The observation did not prove that all of those resources were unnecessary. It showed that eagerly loading everything imposed a substantial cost even for tasks that needed only a fraction of those capabilities.

### 2. Progressive reduction of the initial load

The initial response was to progressively disable optional resources from the initial load and measure the outcome. Extensions, skills, templates, themes, context files, and other nonessential capabilities were removed from the minimum worker configuration.

In that reduced configuration, initial context was approximately **1.6K tokens**. The difference was about **23.7K tokens**, roughly **94%** of the observed initial load.

These numbers are local measurements of one specific configuration. They explain the origin of the architecture; they should not be interpreted as a general benchmark across installations, versions, or models.

### 3. The problem introduced by removing tools

Reducing context solved an important part of the cost, but it introduced an operational question: if the worker did not receive every tool at startup, how could it still have the capability required by a specific request?

A fixed minimal set could leave the worker without reading, search, editing, memory, shell, or another necessary capability. Loading everything again would erase the benefit of reduction. The system needed to decide capabilities per task, rather than from one globally loaded list.

### 4. The birth of Qwen preflight

That need led to a Qwen-based preflight. Before work begins, Qwen inspects the request and dynamically selects only the tools and capabilities needed for the planned phase. The worker receives that subset instead of a complete catalog by default.

Qwen therefore started as a **capability-routing** mechanism: deciding what the worker should be allowed to see and use for a particular task.

### 5. From deciding capabilities to observing progress

The natural next step was to reuse that analysis during execution. If Qwen could already understand the objective, the needed capabilities, and a phase plan, it could also consume worker telemetry — for example, tool calls, results, attempts, state changes, and context use — to assess whether the observed activity represented real progress.

This made it possible to distinguish activity from progress: a worker can continue calling tools without moving toward the outcome, repeat a strategy, or enter a non-convergent sequence.

> **Qwen started as a way to decide what the worker should be allowed to see. It evolved into a way to decide whether the worker was actually making progress.**

### 6. The birth of the active watchdog

The preflight thus evolved into an active watchdog that combines telemetry review with bounded control decisions:

- `continue`: the execution retains evidence of progress and may continue;
- `abort_reroute`: the current strategy is not converging sufficiently, so the task should be recovered in a different context or route;
- `blocked`: no reasonable recovery exists without new information, capability, or an external decision.

The goal is not to replace the worker's judgment at every step. It is to provide an external assessment capable of detecting when continuing the same strategy is no longer justified.

### 7. Later hardening

Operating the watchdog exposed additional guarantees needed to keep its control from introducing new failures. Later evolution added, among other protections:

- a **read-only inspection baseline**, so initial inspection does not modify worker or task state;
- a **meaningful-progress guard**, so an intervention decision does not invalidate verifiable progress that occurred after observation;
- **semantic checkpoint/recovery**, preserving useful facts and results rather than only a tool-call history, so recovery does not restart learning from zero;
- **successful-result evidence**, allowing the supervisor to consider successful results as well as errors or repetitions;
- **termination grace**, allowing a controlled margin for mandatory closing steps before aborting; and
- a **task-identity fence**, binding evidence and recovery state to task identity and preventing contamination across executions.

These protections keep the same design principle: probabilistic evaluations may guide execution, but control actions with destructive effects must respect deterministic state checks and evidence bound to the correct task.
