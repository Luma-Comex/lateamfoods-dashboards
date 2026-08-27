# Dashboards de clientes — LATeamFoods

Sitio publicado con GitHub Pages: https://luma-comex.github.io/lateamfoods-dashboards/

Cada carpeta (`sipia/`, etc.) es el dashboard de un cliente. El HTML publicado **no se edita a mano** — lo genera el script en `tools/` a partir de datos frescos de Salesforce.

## Cómo funciona

- `tools/generar_sipia_dashboard.js` — consulta Salesforce (Contract + Contratct_Products__c + Shippings__c) y regenera `sipia/index.html` a partir de la plantilla `tools/sipia_dashboard_template.html`.
- Una Tarea de Windows en la PC de comex@lateamfoods.com corre este script cada 2 horas y publica el resultado automáticamente (`git add` + `commit` + `push`).

## Para modificar el diseño o la lógica

1. Cloná este repo.
2. Necesitás: [Node.js](https://nodejs.org), el [Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) (`sf`) autenticado contra la org de LAteamFoods, y `git`.
3. Para cambiar el **diseño/HTML estático** (colores, layout, textos fijos): editá `tools/sipia_dashboard_template.html`.
4. Para cambiar **lógica de negocio** (qué cuenta como atraso, cómo se arma cada fila, qué dispara una alerta, etc.): editá `tools/generar_sipia_dashboard.js`.
5. Probá localmente:
   ```
   cd tools
   node generar_sipia_dashboard.js
   ```
   Esto regenera `sipia/index.html` con datos reales — abrilo en el navegador para ver el resultado antes de subirlo.
6. Cuando estés conforme, commiteá y pusheá — la próxima vez que corra la tarea automática, va a bajar tus cambios (`git pull`) antes de regenerar, así que tu versión del script queda como la vigente.

## Ojo con esto

- El script asume que `sf` ya está logueado (no guarda ninguna contraseña ni token en el código).
- Las fechas "hoy" se calculan con la fecha real de la máquina que corre el script — no hay manera de simular "otro día" sin cambiar el reloj del sistema.
- Si agregás un cliente nuevo, la convención es una carpeta por cliente (`sipia/`, `semvra/`, etc.) y un script `generar_<cliente>_dashboard.js` propio en `tools/`.
