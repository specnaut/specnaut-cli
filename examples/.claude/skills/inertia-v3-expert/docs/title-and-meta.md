> ## Documentation Index
>
> Fetch the complete documentation index at: https://inertiajs.com/docs/llms.txt
> Use this file to discover all available pages before exploring further.

# Title & Meta

<Warning>You are viewing the documentation for Inertia.js v3, which is currently in **beta**. For the current stable release, please visit the [v2 documentation](/v2/getting-started/index).</Warning>

Since Inertia powered JavaScript apps are rendered within the document `<body>`, they are unable to render markup to the document `<head>`, as it's outside of their scope. To help with this, Inertia ships with a `<Head>` component which can be used to set the page `<title>`, `<meta>` tags, and other `<head>` elements.

The `<Head>` component will only replace `<head>` elements that are not in your server-side root template.

The `<Head>` component is not available in the Svelte adapter, as Svelte already ships with its own `<svelte:head>` component.

## Head Component

To add `<head>` elements to your page, use the `<Head>` component. Within this component, you can include the elements that you wish to add to the document `<head>`.

<CodeGroup>
  ```vue Vue icon="vuejs" theme={null}
  import { Head } from '@inertiajs/vue3'

  <Head>
      <title>Your page title</title>
      <meta name="description" content="Your page description">
  </Head>
  ```

```jsx React icon="react" theme={null}
import { Head } from '@inertiajs/react'
;<Head>
  <title>Your page title</title>
  <meta name="description" content="Your page description" />
</Head>
```

```svelte Svelte icon="s" theme={null}
<svelte:head>
    <title>Your page title</title>
    <meta name="description" content="Your page description" />
</svelte:head>
```

</CodeGroup>

## Title Shorthand

If you only need to add a `<title>` to the document `<head>`, you may simply pass the title as a prop to the `<Head>` component.

<CodeGroup>
  ```vue Vue icon="vuejs" theme={null}
  import { Head } from '@inertiajs/vue3'

  <Head title="Your page title" />
  ```

```jsx React icon="react" theme={null}
import { Head } from '@inertiajs/react'
;<Head title="Your page title" />
```

```js Svelte icon="s" theme={null}
// Not supported
```

</CodeGroup>

## Title Callback

You can globally modify the page `<title>` using the `title` callback in the `createInertiaApp` setup method. Typically, this method is invoked in your application's main JavaScript file. A common use case for the title callback is automatically adding an app name before or after each page title.

```js theme={null}
createInertiaApp({
  title: (title) => `${title} - My App`,
  // ...
})
```

After defining the `title` callback, the callback will automatically be invoked when you set a title using the `<Head>` component.

<CodeGroup>
  ```vue Vue icon="vuejs" theme={null}
  import { Head } from '@inertiajs/vue3'

  <Head title="Home">
  ```

```jsx React icon="react" theme={null}
import { Head } from '@inertiajs/react'

<Head title="Home">
```

```js Svelte icon="s" theme={null}
// Not supported
```

</CodeGroup>

Which, in this example, will result in the following `<title>` tag.

```html theme={null}
<title>Home - My App</title>
```

The `title` callback will also be invoked when you set the title using a `<title>` tag within your `<Head>` component.

<CodeGroup>
  ```vue Vue icon="vuejs" theme={null}
  import { Head } from '@inertiajs/vue3'

  <Head>
      <title>Home</title>
  </Head>
  ```

```jsx React icon="react" theme={null}
import { Head } from '@inertiajs/react'
;<Head>
  <title>Home</title>
</Head>
```

```js Svelte icon="s" theme={null}
// Not supported
```

</CodeGroup>

## Multiple Head Instances

It's possible to have multiple instances of the `<Head>` component throughout your application. For example, your layout can set some default `<Head>` elements, and then your individual pages can override those defaults.

<CodeGroup>
  ```vue Vue icon="vuejs" theme={null}
  // Layout.vue import { Head } from '@inertiajs/vue3'

  <Head>
      <title>My app</title>
      <meta head-key="description" name="description" content="This is the default description" />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  </Head>

// About.vue import { Head } from '@inertiajs/vue3'

  <Head>
      <title>About - My app</title>
      <meta head-key="description" name="description" content="This is a page specific description" />
  </Head>
  ```

```jsx React icon="react" theme={null}
// Layout.js

import { Head } from '@inertiajs/react'
;<Head>
  <title>My app</title>
  <meta head-key="description" name="description" content="This is the default description" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</Head>

// About.js

import { Head } from '@inertiajs/react'
;<Head>
  <title>About - My app</title>
  <meta head-key="description" name="description" content="This is a page specific description" />
</Head>
```

```js Svelte icon="s" theme={null}
// Not supported
```

</CodeGroup>

Inertia will only ever render one `<title>` tag; however, all other tags will be stacked since it's valid to have multiple instances of them. To avoid duplicate tags in your `<head>`, you can use the `head-key` property, which will make sure the tag is only rendered once. This is illustrated in the example above for the `<meta name="description">` tag.

The code example above will render the following HTML.

```html theme={null}
<head>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <title>About - My app</title>
  <meta name="description" content="This is a page specific description" />
</head>
```

## Head Extension

When building a real application, it can sometimes be helpful to create a custom head component that extends Inertia's `<Head>` component. This gives you a place to set app-wide defaults, such as appending the app name to the page title.

<CodeGroup>
  ```vue Vue icon="vuejs" theme={null}
  <!-- AppHead.vue -->

  <script setup>
  import { Head } from "@inertiajs/vue3";

  defineProps({ title: String });
  </script>

  <template>
    <Head :title="title ? `${title} - My App` : 'My App'">
      <slot />
    </Head>
  </template>
  ```

```jsx React icon="react" theme={null}
// AppHead.js

import { Head } from '@inertiajs/react'

const Site = ({ title, children }) => {
  return (
    <Head>
      <title>{title ? `${title} - My App` : 'My App'}</title>
      {children}
    </Head>
  )
}

export default Site
```

```js Svelte icon="s" theme={null}
// Not supported
```

</CodeGroup>

Once you have created the custom component, you can just start using it in your pages.

<CodeGroup>
  ```vue Vue icon="vuejs" theme={null}
  import AppHead from './AppHead'

  <AppHead title="About" />
  ```

```jsx React icon="react" theme={null}
import AppHead from './AppHead'

<AppHead title="About">
```

```js Svelte icon="s" theme={null}
// Not supported
```

</CodeGroup>

## Inertia Attribute on Elements

Inertia has historically used the `inertia` attribute to track and manage elements in the document `<head>`. However, you can now opt-in to using the more standards-compliant `data-inertia` attribute instead. According to the HTML specification, custom attributes should be prefixed with `data-` to avoid conflicts with future HTML standards.

To enable this, configure the `future.useDataInertiaHeadAttribute` option in your [application defaults](/v3/installation/client-side-setup#configuring-defaults).

```js theme={null}
createInertiaApp({
  // resolve, setup, etc.
  defaults: {
    future: {
      useDataInertiaHeadAttribute: true,
    },
  },
})
```

Built with [Mintlify](https://mintlify.com).
