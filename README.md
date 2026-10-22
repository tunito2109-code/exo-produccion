# EXO · Control de producción

App web para cargar órdenes de producción, seguirlas por estado y cerrarlas con foto de la hoja del pedido. Funciona en la PC y en el celular, y los cambios se ven en vivo en todos los dispositivos.

**Acceso directo:** se comparte el link y la app abre sola, sin usuario ni contraseña, y no registra quién hace cada cosa. Cualquiera que tenga el link puede ver, cargar, editar y borrar pedidos: compartilo solo con gente de confianza.

- **Página:** GitHub Pages (gratis).
- **Datos y fotos:** Firebase de Google, plan gratuito Spark. No pide tarjeta de crédito.

Las fotos se achican antes de subirse y se guardan dentro de la base de datos Firestore. Así no hace falta Cloud Storage, que desde febrero de 2026 exige el plan pago Blaze.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `styles.css`, `app.js` | La aplicación |
| `config.js` | Los datos de conexión a Firebase (lo único que hay que editar) |
| `firestore.rules` | Reglas de la base de datos. Se pegan en la consola de Firebase |
| `catalogo_inicial.txt` | Los 56 artículos del catálogo anterior, para importar desde la app |
| `manifest.webmanifest`, `icon-*.png` | Permiten instalar la app en el celular |

La guía paso a paso completa está en el documento "Guía de instalación · EXO Control de producción".

## Resumen de la instalación

1. En [console.firebase.google.com](https://console.firebase.google.com), creá un proyecto sin Google Analytics.
2. Creá la base **Firestore**: edición Standard, ubicación `southamerica-east1 (São Paulo)`, modo producción.
3. En **Firestore → Reglas**, pegá `firestore.rules` y tocá **Publicar**.
4. En **Authentication → Método de acceso**, habilitá **Anónimo**. Es lo que permite abrir la app directo, sin usuario.
5. En **Configuración del proyecto → Tus apps**, registrá una app web y copiá `apiKey`, `authDomain`, `projectId` y `appId` en `config.js`.
6. Subí todos los archivos a un repositorio de GitHub y activá **Settings → Pages** en `main / (root)`.
7. Entrá a la app, andá a **Catálogo → Importar TXT** y elegí `catalogo_inicial.txt`.

## Compartir la app

Pasá el link (`https://USUARIO.github.io/exo-produccion/`) por WhatsApp o mail. Quien lo abre ya puede usarla. En el celular conviene instalarla: en Android, menú ⋮ → **Agregar a la pantalla principal**; en iPhone, con Safari, compartir → **Agregar a inicio**.

Si el link llega a manos equivocadas, la forma de cortar el acceso es cambiar la dirección: renombrá el repositorio en GitHub (**Settings → Repository name**) y pasá el link nuevo solo a quien corresponda.

## Límites del plan gratuito

| Recurso | Límite gratis | En la práctica |
|---|---|---|
| Espacio en Firestore | 1 GiB | Unas 4.000 fotos más miles de pedidos |
| Lecturas | 50.000 por día | Alcanza para unos 20 dispositivos abriendo la app varias veces por día |
| Escrituras | 20.000 por día | Sobra para cargar pedidos |

Si un día se supera el límite, la app deja de guardar hasta el día siguiente, pero no se pierde nada ni se cobra nada. La app mantiene en vivo solo los últimos 150 pedidos, para ahorrar lecturas. Los anteriores se cargan con **Ver más pedidos**.

## Respaldo

Descargá cada tanto el CSV de pedidos (en Historial) y el de catálogo (en Catálogo). El CSV del catálogo usa el mismo formato que la importación TXT, así que sirve para restaurarlo.
