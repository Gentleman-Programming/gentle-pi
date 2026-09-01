# Evidencia de modelos y límites de atribución

## Propósito

Esta nota delimita qué se puede afirmar públicamente sobre las pruebas de modelos que informaron esta contribución. Se basa en telemetría local de ejecución y en resúmenes de validación. No publica logs en bruto, configuraciones locales, identificadores de usuario, rutas privadas ni el código de la carga de trabajo.

La regla metodológica es simple: que un modelo aparezca en un registro de inferencia demuestra ejecución; no demuestra por sí solo que haya superado, fallado o siquiera completado un benchmark.

## Inventario verificable

| Modelo | Rol observado | Prueba o actividad | Resultado atribuible | Confianza |
|---|---|---|---|---|
| KAT Coder V2.5 Dev | Worker de Pi | Fases acotadas de validación de un contrato de software y sus pruebas deterministas | Una fase registrada informó 17 pruebas deterministas correctas en 0,39 s y diagnóstico estático correcto. Otras ejecuciones muestran que el watchdog puede solicitar `abort_reroute` bajo presión de contexto; ese evento no invalida el resultado de la fase ya cerrada. | Alta |
| Qwen 3.5-35B-A3B | Worker de Pi | Fases acotadas de inspección y validación con estado persistente | Ejecución demostrada. La evidencia pública conservada no contiene un veredicto terminal consolidado para convertirla en aprobación o rechazo de benchmark. | Media |
| Muse Glimmer 30B | Ejecución local | Tareas de análisis y llamadas a herramientas | Ejecución demostrada. No hay un resultado terminal de benchmark suficientemente conservado para una clasificación pública. | Media |
| GLM-4.7-Flash | Ejecución local | Sesión de inferencia registrada | Ejecución demostrada. No hay evidencia terminal suficiente para atribuir un resultado de benchmark. | Media |
| KAT Dev 72B Exp | Ejecución local | Varias sesiones de inferencia | Ejecución demostrada; no se publica una clasificación de rendimiento porque no se conserva un resultado terminal equivalente. | Media |
| Qwen 3.8-27B Uncensored | Ejecución local | Varias sesiones de inferencia | Ejecución demostrada; no se publica una clasificación de rendimiento porque no se conserva un resultado terminal equivalente. | Media |

## Inspector y supervisor

Una prueba controlada validó el canal supervisor + worker para una tarea acotada y de solo lectura. El artefacto que conserva esa prueba no identifica de forma fiable el modelo del supervisor, por lo que esta documentación no atribuye ese resultado a un modelo concreto.

También existía estado local de disponibilidad de un supervisor basado en Qwen. La disponibilidad de un servicio no es evidencia de una prueba completada; por ello no se presenta como un resultado de benchmark.

## Cómo interpretar la evidencia

- **Alta**: identidad de modelo, rol, actividad y resultado concreto están unidos en una misma cadena de evidencia.
- **Media**: la ejecución y la identidad del modelo están demostradas, pero falta un resultado terminal comparable.
- **Baja**: se conserva actividad de inferencia, pero no una atribución suficiente de rol o resultado.

Estas limitaciones son deliberadas. La contribución prefiere una afirmación incompleta y verificable a convertir actividad local o recuerdos de una sesión en una comparación pública.

---

# Model evidence and attribution limits

## Purpose

This note defines what can be stated publicly about the model trials that informed this contribution. It is based on local execution telemetry and validation summaries. It does not publish raw logs, local configuration, user identifiers, private paths, or workload source code.

The methodological rule is straightforward: a model appearing in an inference log proves execution; it does not, by itself, prove that the model passed, failed, or even completed a benchmark.

## Verifiable inventory

| Model | Observed role | Trial or activity | Attributable outcome | Confidence |
|---|---|---|---|---|
| KAT Coder V2.5 Dev | Pi worker | Bounded phases validating a software contract and its deterministic tests | One recorded phase reported 17 deterministic tests passing in 0.39 s and successful static diagnostics. Other executions show that the watchdog may request `abort_reroute` under context pressure; that event does not invalidate the result of an already closed phase. | High |
| Qwen 3.5-35B-A3B | Pi worker | Bounded inspection and validation phases with persisted state | Execution is demonstrated. The retained public evidence has no consolidated terminal verdict that would justify classifying it as a benchmark pass or failure. | Medium |
| Muse Glimmer 30B | Local execution | Analysis tasks and tool calls | Execution is demonstrated. No benchmark terminal result is retained sufficiently to support a public classification. | Medium |
| GLM-4.7-Flash | Local execution | Recorded inference session | Execution is demonstrated. There is no sufficient terminal evidence to attribute a benchmark result. | Medium |
| KAT Dev 72B Exp | Local execution | Multiple inference sessions | Execution is demonstrated; no performance classification is published because no equivalent terminal result is retained. | Medium |
| Qwen 3.8-27B Uncensored | Local execution | Multiple inference sessions | Execution is demonstrated; no performance classification is published because no equivalent terminal result is retained. | Medium |

## Inspector and supervisor

A controlled trial validated the supervisor + worker channel for a bounded, read-only task. The artifact preserving that trial does not reliably identify the supervisor model, so this documentation does not attribute the result to any specific model.

Local readiness state also existed for a Qwen-based supervisor. Service availability is not evidence of a completed trial, so it is not presented as a benchmark result.

## Reading the evidence

- **High**: model identity, role, activity, and a concrete result are joined by the same evidence chain.
- **Medium**: model identity and execution are demonstrated, but a comparable terminal outcome is missing.
- **Low**: inference activity is retained, but role or result cannot be attributed with sufficient confidence.

These limits are intentional. This contribution prefers an incomplete, verifiable statement over converting local activity or session recollection into a public comparison.
