# EXO · Control de producción

App web para cargar órdenes de producción, seguirlas por estado y cerrarlas con foto de la hoja del pedido. Funciona en la PC y en el celular, y los cambios se ven en vivo en todos los dispositivos.

- **Página:** GitHub Pages (gratis).
- **Datos y fotos:** Supabase (gratis hasta 500 MB de base y 1 GB de fotos).
- **Acceso:** cada operario entra con su propio email y contraseña.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `styles.css`, `app.js` | La aplicación |
| `config.js` | Los datos de conexión a Supabase (lo único que hay que editar) |
| `manifest.webmanifest`, `icon-*.png` | Permiten instalarla como app en el celular |
| `supabase/01_estructura.sql` | Crea las tablas, la seguridad y la carpeta de fotos |
| `supabase/02_catalogo_inicial.sql` | Carga los 56 artículos del catálogo anterior |

## 1. Crear la base de datos en Supabase (una sola vez)

1. Entrá a [supabase.com](https://supabase.com), creá una cuenta y un proyecto nuevo. Elegí la región **South America (São Paulo)**, que es la más cercana. Guardá la contraseña de la base en un lugar seguro.
2. En el proyecto, abrí **SQL Editor → New query**. Pegá todo el contenido de `supabase/01_estructura.sql` y tocá **Run**.
3. Hacé lo mismo con `supabase/02_catalogo_inicial.sql`.
4. **Desactivá el registro libre.** Esto es importante: sin este paso, cualquiera que encuentre la página podría crearse un usuario. Andá a **Authentication → Sign In / Providers** y apagá **Allow new users to sign up**.
5. **Creá los usuarios.** Andá a **Authentication → Users → Add user → Create new user**. Cargá email y contraseña, y tildá **Auto Confirm User**. Repetí por cada persona que vaya a usar la app.
6. **Copiá los datos de conexión.** En **Project Settings → API** están el **Project URL** y la **anon public key**. Pegalos en `config.js`:

```js
window.EXO_CONFIG = {
  url: "https://abcdefgh.supabase.co",
  anonKey: "eyJhbGciOi..."
};
```

La anon key puede quedar a la vista en el repositorio: está pensada para eso. Los datos quedan protegidos porque solo los usuarios que creaste pueden iniciar sesión. **Nunca** pongas la `service_role` key en ningún archivo.

## 2. Publicar en GitHub Pages

1. En GitHub, creá un repositorio nuevo, por ejemplo `exo-produccion`. Para usar Pages gratis tiene que ser público.
2. Subí todos los archivos manteniendo la carpeta `supabase/`. Podés arrastrarlos en **Add file → Upload files**.
3. Andá a **Settings → Pages**. En **Source** elegí **Deploy from a branch**, en **Branch** elegí `main` y `/ (root)`, y guardá.
4. En uno o dos minutos la app queda en `https://TU-USUARIO.github.io/exo-produccion/`.

## 3. Instalar en el celular

Abrí la dirección en el celular e iniciá sesión.

- **Android (Chrome):** menú ⋮ → **Agregar a la pantalla principal**.
- **iPhone (Safari):** botón compartir → **Agregar a inicio**.

Queda un ícono como cualquier app, y la sesión se mantiene iniciada.

## Uso

- **Nueva orden:** buscá piezas por código o descripción y ajustá cantidades. Número de pedido y cliente son obligatorios, y el número no se puede repetir.
- **Cargar desde TXT:** acepta líneas como `1035`, `#1035 x2`, `2 x #1035` o `1035;2`. También acepta encabezados opcionales: `Pedido 123`, `Cliente: …`, `Vendedor: …`, `Responsable: …` y `Obs.: …`. El texto que genera **Copiar texto** se puede volver a cargar tal cual.
- **Historial:** se puede filtrar por estado y buscar. Cada pedido permite editarlo, copiarlo, sacarle fotos y eliminarlo.
- **Marcar OK:** pide una foto de la hoja del pedido y recién ahí lo pasa a terminado.
- **Catálogo → Importar TXT:** una línea por artículo, con el formato `CATEGORÍA;CÓDIGO;DESCRIPCIÓN`. Antes de guardar muestra una vista previa. El CSV que descarga la app tiene el mismo formato, así que podés editar en Excel y volver a importar.

## A tener en cuenta

- **Pausa por inactividad.** En el plan gratuito, Supabase pausa el proyecto si pasa **7 días sin uso**. Con uso diario no pasa. Si se pausa, se reactiva desde el panel de Supabase con un clic, sin perder datos.
- **Respaldo.** Descargá cada tanto el CSV de pedidos y de catálogo. Supabase también permite exportar la base desde **Database → Backups**.
- **Espacio para fotos.** Las fotos se achican antes de subirse, a unos 200–400 KB cada una. 1 GB alcanza para unas 3.000 fotos. Para liberar espacio, quitá fotos de pedidos viejos.
- **Dar de baja a alguien.** En **Authentication → Users**, borrá su usuario.
