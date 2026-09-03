# Dashboard de embarques — Handoff para Ari

Este documento explica cómo funciona el dashboard de SIPIA de punta a punta: de dónde sale la información, cómo se arma la página, cómo se publica sola, y qué hacer si hay que tocarlo. La idea es que puedas seguir trabajando sobre esto sin tener que reconstruir el contexto desde cero.

## 1. Qué es esto

Un panel web para que un cliente (por ahora solo **SIPIA**) vea el estado de sus propios embarques: qué contrató, qué se cargó, y el tracking de cada barco. Es la primera pieza de lo que debería terminar siendo un dashboard por cliente (Semvra, Sucesores, etc. después).

**Link en vivo:** https://luma-comex.github.io/luma-foods-dashboards/sipia/

## 2. La idea clave: NO es tiempo real desde el navegador

Cuando alguien abre el link, el navegador no le pregunta nada a Salesforce. Todo el contenido ya está fijo ("horneado") en el HTML en el momento en que se generó. La actualización pasa así:

```
Salesforce  →  script Node (consulta + calcula todo)  →  HTML estático  →  se sube a GitHub  →  GitHub Pages lo sirve
```

Una Tarea de Windows en la PC de operaciones de Comex corre este ciclo completo **cada 2 horas**, automáticamente. Por eso "en vivo" en la práctica significa "actualizado hace como máximo 2 horas", no al segundo.

## 3. Estructura del repo

```
luma-foods-dashboards/
├── index.html              ← landing page, lista de clientes
├── sipia/
│   └── index.html           ← el dashboard PUBLICADO (esto lo genera el script, no se edita a mano)
├── tools/
│   ├── generar_sipia_dashboard.js       ← consulta Salesforce y arma el HTML
│   └── sipia_dashboard_template.html    ← el diseño fijo (CSS/HTML/JS), con marcadores {{...}}
└── README.md                ← guía rápida de cómo correr/editar el generador
```

**Regla de oro: nunca edites `sipia/index.html` a mano.** Se pisa solo en la próxima corrida. Todo cambio real va en `tools/`.

## 4. Cómo arma la página el script (`tools/generar_sipia_dashboard.js`)

1. Corre `sf data query` (Salesforce CLI) contra los objetos `Contract` + `Contratct_Products__c` + `Shippings__c`, filtrando por la cuenta de SIPIA y por contratos "activos".
2. Calcula todo en JavaScript plano: % cargado por producto y por contrato, si un embarque está atrasado, si el buque ya zarpó/está en tránsito/ya llegó, qué mostrar en el botón de tracking, etc.
3. Arma pedazos de HTML (una tarjeta por contrato, una fila por embarque) con funciones tipo `renderContract()`, `renderShipmentRow()`.
4. Reemplaza los marcadores `{{CONTRACTS}}`, `{{STAT_FOB}}`, `{{UPDATED_DATE}}`, etc. en `sipia_dashboard_template.html` por ese HTML/texto ya calculado.
5. Guarda el resultado en `sipia/index.html`.

### Filtro de contratos
Solo se muestran contratos con `Status` en: `In Approval Process` ("On Going"), `Waiting for sign`, `Parcial Loaded`. Los demás (Created, Signed, Loaded, Completed, Cancelled, Paid, Request) se excluyen a propósito — son contratos "no activos" para este panel.

### Reglas de negocio importantes (y por qué)

- **"Delayed Shipping"**: se calcula como `ETD_Updated__c − ETD__c > 15 días`, hecho a mano en el script. **No usar el campo `Delayed_Shipping__c` de Salesforce** — tiene otra lógica interna y da resultados distintos a los que pidió el usuario.
- **Estado del buque** (arribado / en tránsito / aún no zarpa): se calcula comparando la fecha de hoy contra `ETD_Updated__c` y `ETA__c`. Es una **estimación por fechas**, no una posición satelital real.
- **Link de tracking real de la naviera**: es el campo `Link_BL__c`, **no** `Tracking_Page__c` (ese es el link del courier DHL que entrega los documentos físicos, se usa en la sección de "Deliver"). Ojo: `Link_BL__c` a veces no es una URL, a veces es solo el nombre de la naviera en texto libre (ej. "Cosco") — el script detecta si empieza con `http` antes de mostrarlo como botón.
- **"Proforma N.º"** que se muestra en cada tarjeta es el campo `Nro_Proforma__c` de `Contract` — hay un campo con el mismo nombre en `Shippings__c` que es otra cosa, no confundir.
- **Documentación y pagos** por embarque son 3 líneas simples: `Date_of_approval__c` (Aprobado), `Deliver__c`/`Delivery_Date__c` (Deliver, con el link de DHL si es Sí), `Paid__c`/`Amount_to_be_paid__c` (Factura pagada — si el campo viene vacío, se muestra como "No", nunca como "pendiente" ambiguo).
- **Orden de contratos**: de mayor a menor por `Total_Value__c` (Valor FOB).
- **Orden de embarques dentro de un contrato**: primero "En curso", después "Por definir", al final "Cargado" — para que el cliente vea primero lo que todavía se puede accionar.
- **Alertas al abrir la página** (el modal que salta apenas carga): junta los embarques `Loaded` que no tienen `Date_of_approval__c` (documentos sin aprobar) o que no están `Paid` teniendo un monto pendiente (`Amount_to_be_paid__c`).
- **Contratos colapsados por defecto** al abrir la página (para no saturar), con un ícono de producto (🌽/🥒) pegado a la flecha de cada uno para poder identificarlos sin expandir.

## 5. La automatización (Tarea de Windows)

- **Nombre de la tarea:** `Luma Foods - Dashboard SIPIA`, corre cada 2 horas.
- **Script que ejecuta:** `run_sipia_dashboard.bat` (vive en `CLAUDE - LAteamFoods\`, **fuera** del repo — es el único archivo de la automatización que no está en git, porque es específico de esta PC).
- **Qué hace el .bat, en orden:**
  1. `git pull origin main` — así, si vos (Ari) subiste un cambio al script o la plantilla, esta corrida ya lo usa.
  2. `node tools\generar_sipia_dashboard.js` — regenera `sipia/index.html`.
  3. `git add -A` + commit (solo si hay cambios).
  4. `git push origin main` — **siempre se intenta**, aunque esta corrida puntual no haya generado cambios (por si hay un commit tuyo previo sin subir).
- **Log:** `08 - Archivos Varios\sipia_dashboard_auto.log` en esa misma carpeta — revisar ahí primero si algo no se actualiza.

### Bugs ya resueltos (por si vuelven a aparecer)

1. **Query multilínea rompía `sf` en Windows**: `execSync` corre por `cmd.exe`, que no tolera bien un string con saltos de línea reales dentro de comillas — cortaba el comando antes de `--target-org` y tiraba "No default environment found". Se resolvió aplanando la query a una sola línea antes de ejecutarla.
2. **La tarea se colgaba indefinidamente en `git pull`**: sospecha de un prompt de credenciales de Git que no podía mostrarse en el contexto de Task Scheduler. Se resolvió con `GIT_TERMINAL_PROMPT=0` y `GCM_INTERACTIVE=never` en el `.bat`, más un límite de ejecución de 10 minutos en la tarea como red de seguridad.
3. **El push no siempre pasaba**: si una corrida no generaba cambios propios, no intentaba `push`, así que un commit anterior podía quedar sin subir por mucho tiempo. Se separó la lógica: commitear solo si hay cambios, pero intentar `push` siempre.

## 6. Cómo hacer cambios (flujo para Ari)

Necesitás en tu PC: **Node.js**, **Git**, y el **Salesforce CLI (`sf`)** logueado contra la org de Salesforce de Luma Foods.

```
git clone https://github.com/Luma-Comex/luma-foods-dashboards
cd luma-foods-dashboards
node tools/generar_sipia_dashboard.js   # regenera sipia/index.html con datos reales
```

Abrí `sipia/index.html` en el navegador para ver el resultado antes de subir nada.

- **Cambios de diseño** (colores, layout, textos fijos, agregar una sección nueva): editá `tools/sipia_dashboard_template.html`. Es HTML/CSS/JS común — el sistema de diseño usa fuentes Archivo/Public Sans/IBM Plex Mono y una paleta salmón/charcoal (identidad de marca de Luma).
- **Cambios de lógica** (qué cuenta como atraso, cómo se arma cada fila, qué dispara una alerta, qué campos de Salesforce se traen): editá `tools/generar_sipia_dashboard.js`.
- Cuando estés conforme, `git add`, `commit`, `push` normal. La tarea programada en la PC de operaciones baja tus cambios solos en la próxima corrida (máximo 2 horas después).

## 7. Pendientes / limitaciones conocidas

- **No hay login**: el link es público (cualquiera con la URL exacta puede verlo). No aparece en buscadores ni listados, pero no está autenticado. Si se necesita restringir el acceso, es un tema pendiente de diseñar (se evaluó Cloudflare Pages + función de login, no se implementó).
- **Solo SIPIA por ahora**: la estructura (`tools/generar_<cliente>.js`, carpeta `<cliente>/`) está pensada para poder agregar Semvra, Sucesores, etc. como el siguiente paso natural.
- **El tracking del buque es estimado por fechas**, no es posición satelital real (eso requeriría pagar un agregador tipo ShipsGo/SeaRates — se evaluó y se descartó por costo/complejidad frente a usar el link real de la naviera que ya carga el equipo de comex en Salesforce).
