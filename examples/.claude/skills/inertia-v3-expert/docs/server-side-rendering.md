> ## Documentation Index
>
> Fetch the complete documentation index at: https://inertiajs.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Server-Side Rendering (SSR)

export const VueSpecific = ({children}) => {
const [code, setCode] = useState(localStorage.getItem("code")?.replace(/"/g, "") || "Vue");
const callback = useCallback(event => {
if (event.detail.key === "code") {
setCode(event.detail.value.replace(/"/g, ""));
}
}, []);
useEffect(() => {
window.addEventListener("storage", callback);
window.addEventListener("localStorageUpdate", callback);
return () => {
window.removeEventListener("storage", callback);
window.removeEventListener("localStorageUpdate", callback);
};
});
if (code !== "Vue") {
return null;
}
return children;
};

export const SvelteSpecific = ({children}) => {
const [code, setCode] = useState(localStorage.getItem("code")?.replace(/"/g, "") || null);
const callback = useCallback(event => {
if (event.detail.key === "code") {
setCode(event.detail.value.replace(/"/g, ""));
}
}, []);
useEffect(() => {
window.addEventListener("storage", callback);
window.addEventListener("localStorageUpdate", callback);
return () => {
window.removeEventListener("storage", callback);
window.removeEventListener("localStorageUpdate", callback);
};
});
if (!code?.includes("Svelte")) {
return null;
}
return children;
};

export const ReactSpecific = ({children}) => {
const [code, setCode] = useState(localStorage.getItem("code")?.replace(/"/g, "") || null);
const callback = useCallback(event => {
if (event.detail.key === "code") {
setCode(event.detail.value.replace(/"/g, ""));
}
}, []);
useEffect(() => {
window.addEventListener("storage", callback);
window.addEventListener("localStorageUpdate", callback);
return () => {
window.removeEventListener("storage", callback);
window.removeEventListener("localStorageUpdate", callback);
};
});
if (code !== "React") {
return null;
}
return children;
};

export const ClientSpecific = ({children}) => {
const [nada, setNada] = useState();
return children;
};

<Warning>You are viewing the documentation for Inertia.js v3, which is currently in **beta**. For the current stable release, please visit the [v2 documentation](/v2/getting-started/index).</Warning>

Server-side rendering pre-renders your JavaScript pages on the server, allowing your visitors to receive fully rendered HTML when they visit your application. Since fully rendered HTML is served by your application, it's also easier for search engines to index your site.

Server-side rendering uses Node.js to render your pages in a background process; therefore, Node must be available on your server for server-side rendering to function properly. Inertia's SSR server requires Node.js 22 or higher.

## Laravel Starter Kits

If you are using [Laravel Starter Kits](https://laravel.com/docs/starter-kits), Inertia SSR is [supported](https://laravel.com/docs/starter-kits#inertia-ssr) through a build command:

```bash theme={null}
npm run build:ssr
```

## Vite Plugin Setup

The recommended way to configure SSR is with the `@inertiajs/vite` plugin. This approach handles SSR configuration automatically, including development mode SSR without a separate Node.js server.

<Steps>
  <Step title="Install the Vite plugin">
    ```bash  theme={null}
    npm install @inertiajs/vite
    ```
  </Step>

  <Step title="Configure Vite">
    Add the Inertia plugin to your `vite.config.js` file. The plugin will automatically detect your SSR entry point.

    ```js vite.config.js theme={null}
    import inertia from '@inertiajs/vite'
    import laravel from 'laravel-vite-plugin'
    import { defineConfig } from 'vite'

    export default defineConfig({
        plugins: [
            laravel({
                input: ['resources/css/app.css', 'resources/js/app.js'],
                refresh: true,
            }),
            inertia(),
        ],
    })
    ```

    You may also configure SSR options explicitly.

    ```js vite.config.js theme={null}
    inertia({
        ssr: {
            entry: 'resources/js/ssr.js',
            port: 13714,
            cluster: true,
        },
    })
    ```

    You may pass `false` to opt out of the plugin's automatic SSR handling, for example if you prefer to [configure SSR manually](#manual-setup) but still want to use the other features of the Vite plugin.

    ```js vite.config.js theme={null}
    inertia({
        ssr: false,
    })
    ```

  </Step>

  <Step title="Update your build script">
    Update the `build` script in your `package.json` to build both bundles.

    ```json package.json theme={null}
    "scripts": {
        "dev": "vite",
       "build": "vite build" // [!code --]
       "build": "vite build && vite build --ssr" // [!code ++]
    },
    ```

  </Step>
</Steps>

### Development Mode

The Vite plugin handles SSR automatically during development. There is no need to build your SSR bundle or start a separate Node.js server. Simply run your Vite dev server as usual:

```bash theme={null}
npm run dev
```

The Vite plugin exposes a server endpoint that Laravel uses for rendering, complete with HMR support.

<Note>The `vite build --ssr` and `php artisan inertia:start-ssr` commands are for [production](#production) only. You should not run them during development.</Note>

### Production

For production, build both bundles and start the SSR server.

```bash theme={null}
npm run build
php artisan inertia:start-ssr
```

### Custom SSR Entry Point

The Vite plugin reuses your `app.js` entry point for both browser and SSR rendering by default, so no separate file is needed. The plugin detects the `data-server-rendered` attribute to decide whether to hydrate or mount, and the `setup` and `resolve` callbacks are optional.

Most app customizations, such as registering plugins or wrapping with providers, may be handled using the [`withApp` callback](/v3/installation/client-side-setup#customizing-the-app) in your main entry point. A separate SSR entry point is only needed when you require completely different setup logic for the server.

You may create a separate `resources/js/ssr.js` file for this purpose.

<CodeGroup>
  ```js Vue icon="vuejs" theme={null}
  import { createInertiaApp } from '@inertiajs/vue3'
  import createServer from '@inertiajs/vue3/server'
  import { createSSRApp, h } from 'vue'
  import { renderToString } from 'vue/server-renderer'

createServer(page =>
createInertiaApp({
page,
render: renderToString,
resolve: name => {
const pages = import.meta.glob('./Pages/\*_/_.vue')
return pages[`./Pages/${name}.vue`]()
},
setup({ App, props, plugin }) {
return createSSRApp({
render: () => h(App, props),
}).use(plugin)
},
}),
)

````

```jsx React icon="react" theme={null}
import { createInertiaApp } from '@inertiajs/react'
import createServer from '@inertiajs/react/server'
import ReactDOMServer from 'react-dom/server'

createServer(page =>
    createInertiaApp({
        page,
        render: ReactDOMServer.renderToString,
        resolve: name => {
            const pages = import.meta.glob('./Pages/**/*.jsx')
            return pages[`./Pages/${name}.jsx`]()
        },
        setup: ({ App, props }) => <App {...props} />,
    }),
)
````

```js Svelte icon="s" theme={null}
import { createInertiaApp } from '@inertiajs/svelte'
import createServer from '@inertiajs/svelte/server'
import { render } from 'svelte/server'

createServer((page) =>
  createInertiaApp({
    page,
    resolve: (name) => {
      const pages = import.meta.glob('./Pages/**/*.svelte')
      return pages[`./Pages/${name}.svelte`]()
    },
    setup({ App, props }) {
      return render(App, { props })
    },
  })
)
```

</CodeGroup>

Be sure to add anything that's missing from your `app.js` file that makes sense to run in SSR mode, such as plugins or custom mixins.

## Manual Setup

If you prefer not to use the Vite plugin, you may configure SSR manually.

<Steps>
  <Step title="Create an SSR entry point">
    Create an SSR entry point file within your Laravel project.

    <CodeGroup>
      ```bash Vue icon="vuejs" theme={null}
      touch resources/js/ssr.js
      ```

      ```bash React icon="react" theme={null}
      touch resources/js/ssr.jsx
      ```

      ```bash Svelte icon="s" theme={null}
      touch resources/js/ssr.js
      ```
    </CodeGroup>

    This file will look similar to your app entry point, but it runs in Node.js instead of the browser. Here's a complete example.

    <CodeGroup>
      ```js Vue icon="vuejs" theme={null}
      import { createInertiaApp } from '@inertiajs/vue3'
      import createServer from '@inertiajs/vue3/server'
      import { renderToString } from 'vue/server-renderer'
      import { createSSRApp, h } from 'vue'

      createServer(page =>
          createInertiaApp({
              page,
              render: renderToString,
              resolve: name => {
                  const pages = import.meta.glob('./Pages/**/*.vue')
                  return pages[`./Pages/${name}.vue`]()
              },
              setup({ App, props, plugin }) {
                  return createSSRApp({
                      render: () => h(App, props),
                  }).use(plugin)
              },
          }),
      )
      ```

      ```jsx React icon="react" theme={null}
      import { createInertiaApp } from '@inertiajs/react'
      import createServer from '@inertiajs/react/server'
      import ReactDOMServer from 'react-dom/server'

      createServer(page =>
          createInertiaApp({
              page,
              render: ReactDOMServer.renderToString,
              resolve: name => {
                  const pages = import.meta.glob('./Pages/**/*.jsx')
                  return pages[`./Pages/${name}.jsx`]()
              },
              setup: ({ App, props }) => <App {...props} />,
          }),
      )
      ```

      ```js Svelte icon="s" theme={null}
      import { createInertiaApp } from '@inertiajs/svelte'
      import createServer from '@inertiajs/svelte/server'
      import { render } from 'svelte/server'

      createServer(page =>
          createInertiaApp({
              page,
              resolve: name => {
                  const pages = import.meta.glob('./Pages/**/*.svelte')
                  return pages[`./Pages/${name}.svelte`]()
              },
              setup({ App, props }) {
                  return render(App, { props })
              },
          }),
      )
      ```
    </CodeGroup>

  </Step>

  <Step title="Configure Vite">
    Add the `ssr` property to the Laravel Vite plugin configuration.

    <CodeGroup>
      ```js Vue icon="vuejs" vite.config.js theme={null}
      export default defineConfig({
          plugins: [
              laravel({
                  input: ['resources/js/app.js'],
                  ssr: 'resources/js/ssr.js', // [!code ++]
                  refresh: true,
              }),
              // ...
          ],
      })
      ```

      ```js React icon="react" vite.config.js theme={null}
      export default defineConfig({
          plugins: [
              laravel({
                  input: ['resources/js/app.jsx'],
                  ssr: 'resources/js/ssr.jsx', // [!code ++]
                  refresh: true,
              }),
              // ...
          ],
      })
      ```

      ```js Svelte icon="s" vite.config.js theme={null}
      export default defineConfig({
          plugins: [
              laravel({
                  input: ['resources/js/app.js'],
                  ssr: 'resources/js/ssr.js', // [!code ++]
                  refresh: true,
              }),
              // ...
          ],
      })
      ```
    </CodeGroup>

  </Step>

  <Step title="Update your build script">
    Update the `build` script in your `package.json` to build both bundles.

    ```json package.json theme={null}
    "scripts": {
        "dev": "vite",
       "build": "vite build" // [!code --]
       "build": "vite build && vite build --ssr" // [!code ++]
    },
    ```

  </Step>
</Steps>

### Clustering

By default, the SSR server runs on a single thread. You may enable clustering to start multiple Node servers on the same port, with requests handled by each thread in a round-robin fashion.

```js vite.config.js theme={null}
inertia({
  ssr: {
    cluster: true,
  },
})
```

When using a [custom SSR entry point](#custom-ssr-entry-point) or [manual setup](#manual-setup), you may pass the `cluster` option to `createServer` instead.

<CodeGroup>
  ```js Vue icon="vuejs" theme={null}
  createServer(page =>
      createInertiaApp({
          // ...
      }),
      { cluster: true },
  )
  ```

```jsx React icon="react" theme={null}
createServer(
  (page) =>
    createInertiaApp({
      // ...
    }),
  { cluster: true }
)
```

```js Svelte icon="s" theme={null}
createServer(
  (page) =>
    createInertiaApp({
      // ...
    }),
  { cluster: true }
)
```

</CodeGroup>

## Running the SSR Server

<Note>The SSR server is only required in production. During development, the [Vite plugin](#development-mode) handles SSR automatically.</Note>

Once you have built both your client-side and server-side bundles, you may start the SSR server using the following Artisan command.

```bash theme={null}
php artisan inertia:start-ssr
```

You may use the `--runtime` option to specify which runtime you want to use. This allows you to switch from the default Node.js runtime to Bun.

```bash theme={null}
php artisan inertia:start-ssr --runtime=bun
```

With the server running, you should be able to access your app within the browser with server-side rendering enabled. In fact, you should be able to disable JavaScript entirely and still navigate around your application.

## Client-Side Hydration

<ClientSpecific>
  You should also update your `app.js` file to use hydration instead of normal rendering. This allows <VueSpecific>Vue</VueSpecific><ReactSpecific>React</ReactSpecific><SvelteSpecific>Svelte</SvelteSpecific> to pick up the server-rendered HTML and make it interactive without re-rendering it.
</ClientSpecific>

<CodeGroup>
  ```js Vue icon="vuejs" theme={null}
  import { createApp, h } from 'vue' // [!code --]
  import { createSSRApp, h } from 'vue' // [!code ++]
  import { createInertiaApp } from '@inertiajs/vue3'

createInertiaApp({
resolve: name => {
const pages = import.meta.glob('./Pages/\*_/_.vue')
return pages[`./Pages/${name}.vue`]()
},
setup({ el, App, props, plugin }) {
createApp({ render: () => h(App, props) }) // [!code --]
createSSRApp({ render: () => h(App, props) }) // [!code ++]
.use(plugin)
.mount(el)
},
})

````

```js React icon="react" theme={null}
import { createInertiaApp } from '@inertiajs/react'
import { createRoot } from 'react-dom/client' // [!code --]
import { hydrateRoot } from 'react-dom/client' // [!code ++]

createInertiaApp({
    resolve: name => {
        const pages = import.meta.glob('./Pages/**/*.jsx')
        return pages[`./Pages/${name}.jsx`]()
    },
    setup({ el, App, props }) {
        createRoot(el).render(<App {...props} />) // [!code --]
        hydrateRoot(el, <App {...props} />) // [!code ++]
    },
})
````

```js Svelte icon="s" theme={null}
import { createInertiaApp } from '@inertiajs/svelte'
import { mount } from 'svelte' // [!code --]
import { hydrate, mount } from 'svelte' // [!code ++]

createInertiaApp({
  resolve: (name) => {
    const pages = import.meta.glob('./Pages/**/*.svelte')
    return pages[`./Pages/${name}.svelte`]()
  },
  setup({ el, App, props }) {
    mount(App, { target: el, props }) // [!code --]
    if (el.dataset.serverRendered === 'true') {
      // [!code ++:5]
      hydrate(App, { target: el, props })
    } else {
      mount(App, { target: el, props })
    }
  },
})
```

</CodeGroup>

## Error Handling

When SSR rendering fails, Inertia gracefully falls back to client-side rendering. The Vite plugin logs detailed error information to the console, including the component name, request URL, source location, and a tailored hint to help you resolve the issue.

Common SSR errors are automatically classified. Browser API errors (such as referencing `window` or `document` in server-rendered code) include guidance on moving the code to a lifecycle hook. Component resolution errors suggest checking file paths and casing.

Inertia also dispatches an `SsrRenderFailed` event on the server. You may listen for this event to log failures or send them to an error tracking service.

```php theme={null}
use Illuminate\Support\Facades\Log;
use Inertia\Ssr\SsrRenderFailed;

Event::listen(SsrRenderFailed::class, function (SsrRenderFailed $event) {
    Log::warning('SSR failed', $event->toArray());
});
```

### Throwing on Error

For CI or E2E testing, you may prefer SSR failures to throw an exception instead of falling back silently. Set the `throw_on_error` option in your `config/inertia.php` file.

```php theme={null}
'ssr' => [
    'throw_on_error' => (bool) env('INERTIA_SSR_THROW_ON_ERROR', false),
],
```

You may set the environment variable in your `phpunit.xml` to catch SSR errors during testing.

```xml theme={null}
<env name="INERTIA_SSR_THROW_ON_ERROR" value="true"/>
```

## Disabling SSR

Sometimes you may wish to disable server-side rendering for certain pages or routes in your application.

### Per-Route via Middleware

You may use the `$withoutSsr` property on your Inertia middleware to disable SSR for specific route patterns.

```php theme={null}
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /**
     * Defines the routes that should not use SSR.
     *
     * @var array<int, string>
     */
    protected $withoutSsr = [
        'admin/*',
        'dashboard',
    ];
}
```

### Via Facade

You may also disable SSR for specific routes using the `Inertia::withoutSsr()` method, typically called from a service provider.

```php theme={null}
use Inertia\Inertia;

Inertia::withoutSsr(['admin/*', 'dashboard']);
```

### Per-Request

You may disable SSR for the current request by setting the `inertia.ssr.enabled` configuration value to `false`.

```php theme={null}
if (request()->is('admin/*')) {
    config(['inertia.ssr.enabled' => false]);
}
```

## Deployment

When deploying your SSR enabled app to production, you'll need to build both the client-side (`app.js`) and server-side bundles (`ssr.js`), and then run the SSR server as a background process, typically using a process monitoring tool such as Supervisor.

```bash theme={null}
php artisan inertia:start-ssr
```

To stop the SSR server, for instance when you deploy a new version of your website, you may utilize the `inertia:stop-ssr` Artisan command. Your process monitor (such as Supervisor) should be responsible for automatically restarting the SSR server after it has stopped.

```bash theme={null}
php artisan inertia:stop-ssr
```

You may use the `inertia:check-ssr` Artisan command to verify that the SSR server is running. This can be helpful after deployment and works well as a Docker health check to ensure the server is responding as expected.

```bash theme={null}
php artisan inertia:check-ssr
```

By default, a check is performed to ensure the server-side bundle exists before dispatching a request to the SSR server. In some cases, such as when your app runs on multiple servers or is containerized, the web server may not have access to the SSR bundle. To disable this check, you may set the `inertia.ssr.ensure_bundle_exists` configuration value to `false`.

### Laravel Cloud

To run the SSR server on Laravel Cloud, you may use Cloud's [native support for Inertia SSR](https://cloud.laravel.com/docs/compute#inertia-ssr).

### Laravel Forge

To run the SSR server on Forge, you may enable it via the [Inertia SSR toggle](https://forge.laravel.com/docs/sites/laravel#inertia-server-side-rendering-ssr) in your site's application panel. Forge will create the required daemon and, optionally, update your deploy script to restart the SSR server on each deployment.

Built with [Mintlify](https://mintlify.com).
