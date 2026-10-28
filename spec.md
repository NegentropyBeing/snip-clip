# snip-clip — Especificação v0.1

> Status: **rascunho aprovado** · Versão alvo: **v0.1** · Licença: **GPL-3.0** · Nome provisório

## 1. Visão geral

**snip-clip** é um aplicativo de desktop para recortar um ou vários **micro-clipes** de gravações de jogos — principalmente os replays do OBS — e exportá-los prontos para compartilhar, com destaque para o limite de upload gratuito do Discord (**20 MB**).

O fluxo central:

1. Abrir um vídeo (replay do OBS, NVIDIA app ou qualquer outro).
2. Escolher quais **faixas de áudio** entram (jogo, Discord, navegador, microfone…) e ajustar o **volume** de cada uma, ouvindo a mixagem ao vivo.
3. Marcar **um ou vários trechos**.
4. Escolher um **preset** (ex.: *Discord 20 MB*) e exportar — cada trecho como arquivo separado ou todos juntos num clipe.
5. O arquivo vai para a área de transferência, pronto para colar no Discord.

### 1.1 Problema

- Replays do OBS/NVIDIA são grandes (centenas de MB a GB) e têm várias faixas de áudio.
- O Discord gratuito aceita no máximo 20 MB por arquivo e toca só a **primeira** faixa de áudio.
- Fazer isso hoje exige um editor de vídeo pesado ou comandos FFmpeg manuais, com tentativa e erro até caber no limite.

### 1.2 Objetivos da v0.1

- Do vídeo aberto ao clipe colado no Discord em **menos de 1 minuto** para um corte simples.
- **Nunca** entregar um arquivo acima do limite do preset.
- Funcionar em **Windows, Linux e macOS**, em PCs com ou sem GPU dedicada.
- Interface em **inglês e português**, seguindo o idioma do sistema.

### 1.3 Fora de escopo da v0.1

Ver [Roadmap](#13-roadmap-pós-v01). Em resumo: efeitos, texto, recorte vertical, transições, GIF/WebM, webhook, galeria de pastas, auto-atualização.

## 2. Usuários

| Perfil | Necessidade |
|---|---|
| Jogador que grava com OBS (replay buffer, multifaixa) | Cortar o momento, tirar o Discord do áudio, mandar no servidor |
| Jogador com NVIDIA app / outros gravadores | Mesmo fluxo, com 1–2 faixas sem nome |
| Amigos em sistemas diferentes | Instalar e usar sem configurar FFmpeg ou codecs |

## 3. Plataformas e distribuição

| Item | Decisão |
|---|---|
| Sistemas | Windows x64, Linux x64 (`.AppImage` e `.deb`), macOS universal (Intel + Apple Silicon, `.dmg`) |
| Build | GitHub Actions gera os instaladores dos 3 sistemas a cada release |
| Assinatura de código | **Não** na v0.1. O README explica como passar pelo SmartScreen (Windows) e pelo Gatekeeper (macOS) |
| Atualizações | O app consulta o GitHub Releases e **avisa** quando há versão nova (link para download). Sem auto-instalação |
| Repositório | Público no GitHub, licença **GPL-3.0** |

## 4. Arquitetura

```
┌──────────────────────────────── snip-clip (Tauri v2) ────────────────────────────────┐
│                                                                                       │
│  UI (React + TypeScript + Vite + Tailwind + Zustand)                                  │
│   ├─ Player (<video> sem som)  ─┐                                                     │
│   ├─ Mixer (Web Audio: 1 fonte por faixa, ganho por faixa) ─ sincronizado ao player   │
│   ├─ Linha do tempo (cortes, forma de onda)                                           │
│   ├─ Lista de cortes · Presets · Fila de exportação · Configurações                   │
│   └─ i18n (en, pt-BR)                                                                 │
│                      │  comandos/eventos Tauri (IPC)                                  │
│  Núcleo (TypeScript, sem dependência de UI)                                           │
│   ├─ Cálculo de bitrate e escada de resolução                                         │
│   ├─ Montagem de comandos FFmpeg (puro, testável)                                     │
│   └─ Modelo de projeto (vídeo, faixas, cortes, preset)                                │
│                      │                                                                │
│  Backend (Rust)                                                                       │
│   ├─ Provisionamento do FFmpeg (detectar / baixar / verificar SHA-256)                │
│   ├─ Execução de processos FFmpeg/ffprobe + progresso + cancelamento                  │
│   ├─ Fila de exportação                                                               │
│   ├─ Área de transferência de arquivos (Windows / macOS / Linux)                      │
│   └─ Persistência (pasta de dados do app)                                             │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

**Princípio:** a lógica de vídeo (núcleo) não conhece a interface. Se o Tauri não se mostrar adequado, a UI e o backend podem ser trocados por **Electron** reaproveitando o núcleo.

## 5. Requisitos funcionais

### 5.1 Abrir vídeos

- **FR-1** Abrir por **arrastar e soltar**, botão **Abrir** e lista de **Recentes**.
- **FR-2** Aceitar qualquer vídeo que o FFmpeg leia. Ler as faixas com `ffprobe`:
  - usar o **nome da faixa** quando existir (ex.: OBS: *Mix, Jogo, Discord, Navegador, Microfone, Sistema*);
  - senão, exibir **"Faixa 1, 2…"**.
- **FR-3** Detectar **HDR** (PQ/HLG), **fps** e **resolução** da fonte.

### 5.2 Prévia

- **FR-4** Tocar o vídeo original no player, **sem som**.
- **FR-5** Ao abrir, extrair cada faixa de áudio para um arquivo leve temporário e tocá-las via **Web Audio**, sincronizadas com o vídeo.
- **FR-6** Se o sistema não conseguir decodificar o vídeo (ex.: AV1 em macOS anterior ao M3, Linux sem codecs), gerar uma **prévia H.264 540p** e exibir um aviso explicando o motivo. A **exportação sempre usa o arquivo original**.

### 5.3 Faixas e mixagem

- **FR-7** Para cada faixa: **ativar/desativar** e **volume** (0–200%), com efeito imediato na prévia.
- **FR-8** As escolhas de faixa e volume valem para **todos os cortes do vídeo** (a partir da v0.3, cada corte pode diferir: ver §17).
- **FR-9** Forma de onda da **mixagem atual** sob a linha do tempo.

### 5.4 Marcação de cortes

- **FR-10** Criar cortes de três formas: teclas **I/O**, **arrastando** na linha do tempo e pela **lista lateral**.
- **FR-11** Na lista: renomear, ajustar início/fim numericamente, reordenar, apagar.
- **FR-12** Dicas de atalho visíveis na interface (barra de atalhos / tooltips).

| Atalho | Ação |
|---|---|
| `Espaço` / `K` | Tocar / pausar |
| `J` / `L` | Voltar / avançar (repetir acelera) |
| `←` / `→` | 1 frame |
| `Shift+←` / `Shift+→` | 1 segundo |
| `I` / `O` | Marcar início / fim do corte |
| `Enter` | Confirmar corte |
| `Delete` | Apagar corte selecionado |
| `Ctrl/Cmd+E` | Exportar |

### 5.5 Persistência

- **FR-13** Cortes, faixas e volumes são **salvos automaticamente** por vídeo, num JSON na pasta de dados do app. Nada é gravado ao lado dos vídeos do usuário.
- **FR-14** O vídeo é identificado por **caminho + tamanho + data de modificação**.

### 5.6 Exportação

- **FR-15** Modo de saída:
  - **Separados** (padrão): um arquivo por corte;
  - **Montagem**: todos os cortes, na ordem da lista, num único arquivo, com **corte seco**.
- **FR-16** Presets:

| Preset | Codec vídeo | Áudio | Limite | Observações |
|---|---|---|---|---|
| **Discord 20 MB** *(padrão)* | H.264 | AAC estéreo, 1 faixa mixada | 20 MB | Máxima compatibilidade (inclusive celulares) |
| Discord 20 MB · AV1 | AV1 | AAC, 1 faixa mixada | 20 MB | ~30–40% mais qualidade; pode não tocar em celulares antigos |
| Nitro Basic 50 MB | H.264 | AAC, 1 faixa mixada | 50 MB | |
| Nitro 500 MB | H.264 | AAC, 1 faixa mixada | 500 MB | |
| Sem limite | AV1 (qualidade constante) | AAC; opção **manter faixas separadas** | — | Mantém HDR e fps originais |
| Original, sem recodificar | cópia | cópia das faixas escolhidas | — | Instantâneo, sem perda; corte ajustado ao keyframe; sem mixagem/volume |

- **FR-17** Formato de saída: **MP4** com `+faststart`.
- **FR-18** **Fila de exportação** em segundo plano, com progresso e cancelamento por item; o usuário continua editando enquanto exporta.
- **FR-19** Destino padrão: pasta de vídeos do sistema + `Clips` (`Vídeos\Clips`, `~/Movies/Clips`, `~/Videos/Clips`), configurável.
- **FR-20** Nome do arquivo: `<vídeo original> - <nome do corte>.mp4`; sem nome, `<vídeo original> - 00m12s-00m40s.mp4`. Nunca sobrescrever: acrescentar ` (2)`, ` (3)`…
- **FR-21** Após exportar: **copiar o arquivo** (não o caminho) para a área de transferência, nos 3 sistemas, e oferecer **Mostrar na pasta**.

## 6. Regras de codificação

### 6.1 Tamanho-alvo garantido

- **Alvo** = 97,5% do limite (ex.: **19,5 MB** para 20 MB). **Limite verificado** = 20 × 10⁶ bytes (interpretação conservadora).
- Orçamento de vídeo:

  ```
  bitrate_video_kbps = (alvo_bytes × 8 / 1000) / duração_s − bitrate_áudio_kbps − overhead_mux
  ```

- **Áudio:** AAC estéreo **128 kbps**; **96 kbps** quando o orçamento de vídeo ficar abaixo de ~2,5 Mbps.
- **Verificação final:** se o arquivo ultrapassar o limite, **recodificar automaticamente** com bitrate reduzido proporcionalmente ao excesso (+ margem), até caber. O usuário nunca recebe um arquivo acima do limite.

### 6.2 Escada de resolução e fps (presets com limite)

Escolher o primeiro degrau cujo bitrate mínimo cabe no orçamento. Nunca aumentar acima da fonte.

| Degrau | Bitrate mínimo H.264 | Bitrate mínimo AV1 |
|---|---|---|
| 1440p60 | 9 Mbps | 5,5 Mbps |
| 1080p60 | 5 Mbps | 3 Mbps |
| 1080p30 | 3 Mbps | 1,8 Mbps |
| 720p30 | abaixo disso | abaixo disso |

- Abaixo de **~1 Mbps**: aviso *"Este corte tem X min; em 20 MB a qualidade ficará baixa — considere encurtar."*
- O usuário pode **travar** resolução/fps manualmente.
- Valores iniciais; serão calibrados com testes de VMAF.

### 6.3 Outras regras

- **FR-22** fps limitado a **60** nos presets com limite; presets sem limite mantêm o original.
- **FR-23** Fonte **HDR** → **tonemapping para SDR (BT.709)** nos presets com limite; preset *Sem limite* mantém HDR.
- **FR-24** Áudio mixado com `amix` respeitando ativação e volumes por faixa (presets com limite sempre geram **1 faixa**).
- **FR-25** Corte com precisão de frame em todos os presets recodificados.

### 6.4 Encoders

- **FR-26** Na primeira execução, testar (≈1 s cada) os encoders disponíveis: **NVENC (NVIDIA) → AMF (AMD) → QuickSync (Intel) → CPU (x264 / SVT-AV1)**.
- **FR-27** Preset *Discord 20 MB* usa por padrão **x264 em 2 passagens (CPU)** — precisão de tamanho e funciona em qualquer PC. GPU disponível como opção "rápida".
- **FR-28** Usuário pode escolher *Automático / GPU / CPU* nas configurações.

## 7. Provisionamento do FFmpeg

- **FR-29** Procurar um FFmpeg/ffprobe no sistema (PATH) com versão e recursos suficientes.
- **FR-30** Se não houver, mostrar tela explicando **por que é necessário**, **de onde vem** e **quanto ocupa**, com botão **Baixar**.
- **FR-31** Baixar uma **versão fixa** (Windows/Linux: builds do BtbN; macOS: build estática definida no código), verificar **SHA-256** e instalar na pasta de dados do app. Nunca baixar "a mais recente" sem verificação.
- **FR-32** Sem FFmpeg funcional, o app não permite abrir vídeos, mas continua mostrando a tela de instalação.

## 8. Configurações

| Opção | Padrão |
|---|---|
| Pasta de exportação | `<Vídeos do sistema>/Clips` |
| Preset padrão | Discord 20 MB |
| Encoder | Automático |
| Idioma | Sistema (EN / pt-BR) |
| Tema | Sistema (claro / escuro) |

## 9. Internacionalização

- **FR-33** Textos em arquivos de tradução desde o início; inglês como base, **pt-BR** completo.
- **FR-34** Idioma segue o sistema; troca manual nas configurações.

## 10. Privacidade

- **Zero telemetria.** Nenhuma coleta de uso, analytics ou envio de erros — nunca.
- Conexões de rede apenas: (1) download do FFmpeg, quando o usuário confirma; (2) consulta de versão no GitHub Releases.
- Declarado no README.

## 11. Qualidade e testes

| Camada | Ferramenta | Cobertura mínima |
|---|---|---|
| Núcleo (TS) | Vitest | Cálculo de bitrate, escada de resolução, montagem de comandos FFmpeg por preset, nomes de arquivo |
| Backend (Rust) | `cargo test` | Detecção/verificação do FFmpeg, parsing de progresso, fila |
| Integração | Vitest + FFmpeg real | Exportar clipes sintéticos e verificar tamanho ≤ limite, faixas e duração |
| CI | GitHub Actions | Testes a cada push; build dos instaladores em tags de release |

## 12. Critérios de aceite da v0.1

1. Abrir um replay do OBS (AV1, 6 faixas) e ver os nomes das faixas.
2. Desativar *Discord*, aumentar *Jogo* e ouvir a diferença na prévia em tempo real.
3. Marcar 3 cortes com `I`/`O` e exportar como **separados** e como **montagem**.
4. Todos os arquivos do preset *Discord 20 MB* com **≤ 20 MB**, 1 faixa de áudio, H.264, tocando no Discord desktop e mobile.
5. Colar o clipe no Discord com `Ctrl/Cmd+V` logo após exportar.
6. Fonte HDR exportada para Discord sem cores lavadas.
7. Fechar e reabrir o app: cortes do vídeo continuam lá.
8. Instalar e usar em Windows, Linux e macOS sem FFmpeg pré-instalado.
9. Funcionar em PC **sem GPU dedicada** (encoder CPU).
10. Interface em pt-BR num sistema em português e em inglês num sistema em inglês.

## 13. Roadmap (pós-v0.1)

| Funcionalidade | Origem |
|---|---|
| Recorte vertical 9:16, câmera lenta, texto/legenda, fade | Escopo de edição |
| Envio via **webhook** do Discord (arquitetura de "destinos" já prevista) | Pós-exportação |
| Transições na montagem (fade / crossfade) | Montagem |
| **Galeria** com miniaturas de uma pasta (ex.: `F:\OBS Replays`) | Abertura |
| Formatos **GIF** e WebM | Saída |
| Forma de onda **por faixa** | Linha do tempo |
| **Auto-atualização** (Tauri updater) | Distribuição |
| Assinatura de código (Windows / macOS) | Distribuição |
| "Modo biblioteca" (compressão em lote) — projeto separado | Fora do app |

## 14. Riscos e pontos a validar

| Risco | Mitigação |
|---|---|
| Sincronia vídeo × Web Audio em clipes longos | Ressincronizar a cada seek/pausa; teste de deriva em 3 min |
| Decodificação AV1 nos WebViews (macOS/Linux) | Prévia H.264 automática (FR-6) |
| Precisão do tamanho com encoders de GPU | x264 2 passagens como padrão; recodificação automática (6.1) |
| Copiar arquivo para a área de transferência no Linux (Wayland/X11) | Implementar `text/uri-list`; fallback *Mostrar na pasta* |
| Licenciamento do FFmpeg (GPL) | App GPL-3.0; FFmpeg baixado separadamente com aviso de licença |
| Interpretação de "20 MB" pelo Discord (MB vs MiB) | Verificar contra 20 × 10⁶ bytes (conservador) |

## 15. Decisões registradas

| # | Decisão |
|---|---|
| Stack | Tauri v2 + React/TS direto (sem protótipo PySide6); núcleo isolado para permitir troca por Electron |
| Saída de múltiplos cortes | Separados (padrão) ou montagem |
| Limites | Presets; *Discord 20 MB* padrão |
| Entrada | Qualquer vídeo; nomes de faixa quando existirem |
| Áudio | Mixado em 1 faixa nos presets com limite; separadas opcionais no *Sem limite* |
| Plataformas | Windows, Linux, macOS desde a v0.1 |
| Encoders | Detecção automática com fallback para CPU |
| FFmpeg | Do sistema, ou download na primeira execução com explicação |
| Licença | GPL-3.0 |
| Idiomas | EN + pt-BR, seguindo o sistema |
| Pós-exportação | Copiar arquivo + mostrar na pasta; webhook depois |
| Codec padrão Discord | H.264; AV1 opcional |
| Telemetria | Nenhuma, nunca |
| Publicação | Repositório local primeiro; público após aprovação |
| Perfil de replay (v0.2) | Gerenciado pelo snip-clip na aba Gravação; scripts Python removidos ([ADR 0001](docs/adr/0001-snip-clip-manages-the-replay-profile.md)) |
| Ajuste do corte (v0.3) | Guarda só as faixas que diferem da mixagem; o resto segue o vídeo (§17) |

## 16. v0.2 — Gravação (perfil de replay)

O snip-clip passa a instalar e gerenciar o **perfil de replay** no OBS (ver [GLOSSARY.md](GLOSSARY.md) e [ADR 0001](docs/adr/0001-snip-clip-manages-the-replay-profile.md)), substituindo os scripts de `extras/obs/`, que são removidos. Windows e Linux; no macOS a aba aparece com o aviso "ainda não disponível".

### 16.1 Aba Gravação

As Configurações passam a ter as abas **Geral** e **Gravação**.

- **FR-35** Estado: OBS encontrado (nativo ou Flatpak no Linux), aberto ou fechado; perfil de replay instalado ou não; no Linux, plugin de áudio por app presente ou não.
- **FR-36** Instalar e reconfigurar o perfil de replay. Campos visíveis: duração do buffer, pasta de replays, encoder (Automático ou um da lista), navegadores. Em *Avançado* (recolhido): limite de memória, resolução, fps, qualidade. Os nomes das faixas seguem o idioma do snip-clip.
- **FR-37** Com o perfil de replay instalado, o formulário é preenchido com os valores lidos dos arquivos do OBS (a fonte da verdade), não de uma cópia do snip-clip.
- **FR-38** Instalar, reconfigurar e remover são recusados com o OBS aberto, com pedido para fechá-lo. A versão anterior do perfil é copiada para backup a cada instalação.
- **FR-39** Remover: apaga o perfil e a coleção de cenas, desliga o início automático e desliga o servidor WebSocket só se foi o snip-clip que o ligou. Os backups ficam.
- **FR-40** Início automático: "Abrir o OBS com o perfil de replay quando eu entrar na minha conta", **desmarcado** por padrão. Botão **Abrir o OBS agora**.
- **FR-41** Encoder automático: usa o teste de encoders que o snip-clip já faz (AV1 → HEVC → H.264; NVENC antes de VAAPI; senão x264).
- **FR-42** OBS não encontrado: mostra como instalar (Windows: `winget` e obsproject.com; Linux: Flathub ou pacote da distribuição) e desabilita *Instalar*. Nada é baixado.
- **FR-43** Linux sem o plugin obs-pipewire-audio-capture: aviso destacado com o comando de instalação para o OBS encontrado (Flatpak ou nativo). A instalação continua possível, com 3 faixas (Mix, Microfone, Sistema).

### 16.2 Atalho para salvar o replay

- **FR-44** Campo **Atalho para salvar o replay** (padrão Alt+F10), aplicado conforme o ambiente:
  - Windows e Linux X11: nas configurações do perfil de replay no OBS;
  - Linux Wayland no GNOME: atalho personalizado do GNOME que chama `snip-clip --save-replay`, avisando se a combinação já estiver em uso (o GNOME usa Alt+F10 para maximizar);
  - outros ambientes Wayland: comando pronto para copiar e instruções.
- **FR-45** `snip-clip --save-replay` salva o replay pelo servidor WebSocket do OBS sem abrir a janela do app e mostra uma notificação com o resultado. No Wayland, instalar o perfil de replay liga esse servidor (com senha; uma senha existente é mantida).

### 16.3 Pasta de abertura

- **FR-46** Configuração **Pasta de abertura** na aba Geral: onde o diálogo *Abrir vídeo* começa. Segue a pasta de replays do perfil de replay; sem perfil, a pasta de Vídeos do sistema; pode ser trocada por outra sem mudar o OBS.

### 16.4 Fora de escopo da v0.2

Salvar replays com o snip-clip rodando em segundo plano; restaurar backups pela interface; destacar replays novos (fica com a galeria); registrar o atalho automaticamente no KDE; perfil de replay no macOS.

### 16.5 Critérios de aceite da v0.2

1. Windows sem perfil: instalar pela aba, abrir o OBS pela aba, salvar com o atalho e abrir o replay no snip-clip com 6 faixas nomeadas.
2. Mudar o buffer direto no OBS e ver o valor novo na aba; reconfigurar pela aba e ver o backup criado.
3. Com o OBS aberto, instalar e remover são recusados.
4. Remover deixa o OBS sem o perfil de replay e sem início automático.
5. Linux X11 e Wayland (GNOME), OBS nativo e Flatpak, com e sem o plugin: o perfil funciona; sem o plugin aparece o aviso e o replay tem 3 faixas.
6. Wayland GNOME: o atalho escolhido na aba salva o replay com um jogo em foco, e `snip-clip --save-replay` mostra a notificação.
7. O diálogo *Abrir vídeo* começa na pasta de replays; após trocar a pasta de abertura, começa na nova.
8. OBS ausente: a aba mostra como instalar e *Instalar* fica desabilitado.

## 17. v0.3 — Ajuste do corte

Cada **corte** pode diferir da **mixagem** do vídeo em algumas faixas: o **ajuste do corte** (ver [GLOSSARY.md](GLOSSARY.md)). Ex.: tirar o Discord só do corte em que alguém falou o que não devia.

### 17.1 Modelo

- **FR-47** O ajuste do corte guarda só as faixas que diferem da mixagem, cada uma com ativação e volume próprios. As demais faixas **seguem a mixagem do vídeo**, inclusive mudanças feitas depois (herança). O ajuste vale nos dois sentidos: o corte pode ligar uma faixa que o vídeo desligou.
- **FR-48** Um corte novo nasce sem ajuste, mesmo com outro corte ajustado selecionado.
- **FR-49** O ajuste é salvo com os cortes (FR-13) num campo opcional: projetos antigos abrem sem ajustes; uma versão anterior do snip-clip ignora o campo (e o perde no próximo salvamento), mas mantém os cortes.

### 17.2 Interface

- **FR-50** No painel **Faixas**, com um corte selecionado, aparece o seletor **Vídeo | Este corte**, que começa em *Vídeo*. Em *Este corte*, as faixas que seguem o vídeo aparecem esmaecidas com a marca "segue o vídeo"; mexer numa faixa cria o ajuste dela, e cada faixa ajustada tem ↺ para voltar a seguir o vídeo.
- **FR-51** Na lista de cortes, um corte com ajuste mostra uma marca com a dica do que muda (ex.: "Discord desligado, Jogo 60%") e a ação **Remover ajuste**.

### 17.3 Prévia e forma de onda

- **FR-52** Dentro de um corte, a prévia toca a mixagem com o ajuste do corte; fora dos cortes, a mixagem do vídeo. Onde cortes se sobrepõem vale o corte selecionado; sem seleção, o que começa primeiro.
- **FR-53** A forma de onda (mixada ou por faixa) mostra o ajuste no trecho de cada corte, pela mesma regra do FR-52.

### 17.4 Exportação

- **FR-54** Presets com 1 faixa mixada aplicam o ajuste de cada corte.
- **FR-55** *Sem limite* com faixas separadas: uma faixa entra no arquivo se estiver ligada em pelo menos um corte; nos cortes em que está desligada, vira silêncio (a montagem continua possível).
- **FR-56** *Original, sem recodificar*: vale a escolha de faixas de cada corte; volumes continuam ignorados.
- **FR-57** Na montagem, o som muda bruscamente na emenda entre cortes com ajustes diferentes (transições continuam no roadmap).

### 17.5 Critérios de aceite da v0.3

1. Desligar o Discord só no corte 2: a prévia do corte 2 não tem Discord, a dos outros tem; o arquivo exportado do corte 2 também não.
2. Depois do ajuste, baixar o Jogo para 60% no vídeo: o corte 2 também fica com o Jogo em 60% e continua sem Discord.
3. ↺ numa faixa e *Remover ajuste* voltam a seguir o vídeo; a marca some da lista de cortes.
4. Montagem com faixas separadas (*Sem limite*) e o Discord desligado só num corte: o arquivo tem a faixa do Discord, em silêncio naquele trecho.
5. Fechar e reabrir o vídeo mantém os ajustes.
