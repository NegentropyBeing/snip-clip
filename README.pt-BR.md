<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/brand/banner-dark.png">
    <img src="assets/brand/banner-light.png" alt="snip-clip" width="640">
  </picture>
</p>

# snip-clip

[English](README.md) · **Português**

Recorte um ou vários micro-clipes de gravações de jogos (replays do OBS, app da NVIDIA, qualquer vídeo que o FFmpeg leia) e exporte prontos para compartilhar — por padrão como **arquivos do tamanho do Discord (≤ 20 MB)**.

> **Status:** prévia inicial (**v0.1 beta**). Veja o [ROADMAP.md](ROADMAP.md) (em inglês) e a [spec.md](spec.md).

## O que ele faz (v0.1)

- Abrir uma gravação e ver as faixas de áudio pelo nome (OBS: *Jogo, Discord, Navegador, Microfone…*).
- Ligar e desligar faixas e ajustar o volume de cada uma ouvindo a mixagem ao vivo.
- Marcar vários cortes com `I` / `O` e exportar cada um separado ou juntar todos numa montagem.
- Presets de tamanho (Discord 20 MB, Nitro 50 / 500 MB, sem limite, cópia sem perda) com **garantia** de ficar abaixo do limite.
- Copiar o arquivo exportado para a área de transferência, pronto para colar no Discord.
- Windows, Linux e macOS · inglês e português.

## Instalação

Baixe o instalador do seu sistema em [Releases](https://github.com/NegentropyBeing/snip-clip/releases):

| Sistema | Arquivo |
|---|---|
| Windows | `snip-clip_<versão>_x64-setup.exe` |
| macOS (Intel e Apple Silicon) | `snip-clip_<versão>_universal.dmg` |
| Linux | `snip-clip_<versão>_amd64.AppImage` ou `.deb` |

Os instaladores ainda não têm assinatura digital:

- **Windows:** o SmartScreen pode avisar. Clique em *Mais informações → Executar assim mesmo*.
- **macOS:** na primeira vez, clique com o botão direito no app em *Aplicativos* e escolha *Abrir*, ou libere em *Ajustes do Sistema → Privacidade e Segurança*.

Ao abrir pela primeira vez, o snip-clip procura o FFmpeg no computador. Se não encontrar, oferece baixar uma versão fixa do FFmpeg, conferida por checksum, para a própria pasta (entre 30 e 200 MB, dependendo do sistema). Você também pode instalar o FFmpeg por conta própria (`winget install Gyan.FFmpeg`, `brew install ffmpeg`, `sudo apt install ffmpeg`).

Os clipes exportados vão para `Vídeos\Clips` (macOS: `Filmes/Clips`) e são copiados para a área de transferência, prontos para colar no Discord. As duas coisas podem ser mudadas em *Configurações* (`Ctrl+,`).

## Gravando com o OBS (Windows)

A pasta [`extras/obs/`](extras/obs) configura o OBS Studio como um gravador de "replay instantâneo" com os arquivos que o snip-clip aproveita melhor: o replay buffer fica sempre ligado (salve com **Alt+F10**) e cada fonte vai para uma faixa de áudio própria com nome (*Mix, Jogo, Discord, Navegador, Microfone, Sistema*), para você poder tirar o Discord ou o navegador de um clipe depois.

> [!IMPORTANT]
> **Desligue o NVIDIA Instant Replay (ShadowPlay) antes de usar este perfil.** Os dois usam **Alt+F10** para salvar o replay, e com os dois ligados ficam dois replay buffers e dois encoders de GPU ocupados, dobrando o uso de RAM e de encoder. No app da NVIDIA, pressione **Alt+Z** e desligue o **Instant Replay**.

**[Como instalar e ativar o perfil do OBS →](extras/obs/README.pt-BR.md)**: requisitos, opções (duração do buffer, encoder, pasta de saída, navegadores…), iniciar junto com o Windows e como desfazer.

Para os nomes das faixas em português, crie o perfil com `--lang pt`.

## Privacidade

O snip-clip **não tem telemetria**: nada de analytics, dados de uso ou relatórios de erro. Ele só acessa a internet para baixar o FFmpeg (depois que você confirmar) e para consultar o GitHub Releases em busca de versão nova.

## Desenvolvimento

Requisitos: Node 20+, pnpm, Rust (stable), FFmpeg no `PATH` para os testes de integração e os [pré-requisitos do Tauri](https://tauri.app/start/prerequisites/) para o seu sistema.

```sh
pnpm install
pnpm tauri dev            # roda o app
pnpm test                 # testes unitários (núcleo)
pnpm test:integration     # exportações reais com FFmpeg em clipes sintéticos
pnpm typecheck
```

### Estrutura

| Caminho | Função |
|---|---|
| `src/core/` | Motor independente de plataforma: presets, cálculo de bitrate/tamanho, montagem dos comandos FFmpeg, re-tentativa de exportação |
| `src/` | Interface React |
| `src-tauri/` | Backend em Rust: provisionamento do FFmpeg, execução de processos, área de transferência, persistência |
| `tests/` | Testes de integração com um FFmpeg real |
| `assets/brand/` | Logo: fonte do ícone do app, SVGs do badge e da tesoura, banners do README |
| `extras/obs/` | Configuração opcional do perfil do OBS e atalho para gravar replays (Windows) |

## Licença

[GPL-3.0](LICENSE). O FFmpeg é um programa separado, baixado na primeira execução sob a licença dele.
