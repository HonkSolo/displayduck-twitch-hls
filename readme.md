<a id="readme-top"></a>

<div align="center">

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]

</div>

<br />
<div align="center">
  <a href="https://github.com/brood-works/displayduck-pack-example">
    <img src="logo.png" alt="Logo" width="80" height="80">
  </a>
  <img src="img/twitch.webp" alt="Twitch" width="80" height="80">

  <h3 align="center">Twitch HLS</h3>

  <p align="center">
    Display Twitch live streams in DisplayDuck using HLS.
  </p>
</div>

> [!WARNING]
> Although this pack works for anyone, it is intended for Twitch creators who want to monitor their own stream without interruptions.
>
> Direct HLS playback may violate Twitch’s Terms of Service. Use it at your own risk.

---

## About
This pack adds a Twitch Stream widget to DisplayDuck. It checks whether the configured channel is live, starts DisplayDuck’s local HLS proxy, and plays the stream in the widget. The stream status is checked every five seconds while the widget is active.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

## Configurable options

| Setting | Type | Configurable Values | Default Value |
|---|---|---|---|
| Twitch Channel | `string` | channel login or Twitch URL | empty |
| Auto-hide | `boolean` | `true`<br />`false` | `false` |


<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started
Build the pack from this directory with Node 24 or newer:

```bash
npm install
npm run build
```

The compiler writes the widget bundle to `dist/twitch-hls.js`. Use the development command for watch mode:

```bash
npm run development
```

To load the pack during local development, enable Developer Mode in DisplayDuck and add either this directory or its parent `plugins/enabled` directory under the local widget paths.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion, please fork the repo and create a pull request, or open an issue with the tag “enhancement”.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Contributors:

<a href="https://github.com/brood-works/displayduck-pack-example/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=brood-works/displayduck-pack-example" />
</a>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

[contributors-shield]: https://img.shields.io/github/contributors/brood-works/displayduck-pack-example.svg
[contributors-url]: https://github.com/brood-works/displayduck-pack-example/graphs/contributors
[forks-shield]: https://img.shields.io/github/forks/brood-works/displayduck-pack-example
[forks-url]: https://github.com/brood-works/displayduck-pack-example/network/members
[stars-shield]: https://img.shields.io/github/stars/brood-works/displayduck-pack-example
[stars-url]: https://github.com/othneildrew/Best-README-Template/stargazers
[issues-shield]: https://img.shields.io/github/issues/brood-works/displayduck-pack-example
[issues-url]: https://www.best-readme-template.com/issues
