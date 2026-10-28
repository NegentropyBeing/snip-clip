# Perfil de replay do OBS — como instalar e usar

[English](README.md) · **Português**

Isto configura o OBS Studio no Windows como um gravador de "replay instantâneo" sempre ligado: os últimos minutos ficam na memória e são salvos num arquivo quando você aperta **Alt+F10**. Cada fonte de áudio ganha uma faixa própria com nome, então no snip-clip você pode tirar o Discord ou o navegador de um clipe, ou abaixar o microfone.

| Faixa | Nome | Conteúdo |
|---|---|---|
| 1 | Mix | Jogo + Discord + navegador + microfone |
| 2 | Jogo | Áudio da captura de jogo |
| 3 | Discord | Só o app do Discord |
| 4 | Navegador | Os navegadores que você escolher |
| 5 | Microfone | Microfone padrão |
| 6 | Sistema (tudo) | Tudo o que o PC toca (reserva, caso alguma fonte escape) |

Os nomes acima são os da versão em português (`--lang pt`). Por padrão o script segue o idioma do Windows.

## 1. Antes de começar

- **Instale o OBS Studio** pelo [obsproject.com](https://obsproject.com/), ou rode `winget install OBSProject.OBSStudio`.
- **Instale o Python 3** pelo [python.org](https://www.python.org/downloads/) (marque *Add python.exe to PATH*), ou rode `winget install Python.Python.3.12`.
- **Desligue o NVIDIA Instant Replay (ShadowPlay).** Ele também salva com Alt+F10, e com os dois ligados o uso de RAM e de encoder da GPU dobra. No app da NVIDIA, pressione **Alt+Z** e desligue o **Instant Replay**. No GeForce Experience a opção fica no mesmo overlay do Alt+Z.
- **Feche o OBS.** Ele regrava as configurações ao sair, então mudanças feitas com ele aberto se perdem.

## 2. Baixe os arquivos

Baixe este repositório (botão verde **Code** → **Download ZIP**) e extraia, ou clone com git. Você só precisa dos dois arquivos em `extras/obs/`.

## 3. Crie o perfil

Abra um terminal em `extras/obs/` (no Explorer: clique com o botão direito na pasta → *Abrir no Terminal*) e rode:

```sh
python obs-setup.py --lang pt
```

Se `python` abrir a Microsoft Store, use `py obs-setup.py --lang pt`.

Isso cria um perfil e uma coleção de cenas, ambos chamados **snip-clip Replay**, com:

- buffer de 3 minutos, salvo com **Alt+F10**
- a resolução da sua tela principal a 60 fps
- o melhor encoder que o seu PC suporta, descoberto num teste rápido: NVENC AV1, depois HEVC, depois H.264, senão x264 na CPU (qualidade constante 28)
- replays salvos em `Vídeos\OBS Replays`
- Chrome e Firefox na faixa Navegador

Seus outros perfis do OBS não são alterados. Se já existir um perfil **snip-clip Replay**, ele é copiado antes para `%APPDATA%\obs-studio\basic\backup-<data>\`.

### Opções

Combine as que quiser:

| Opção | Exemplo | Padrão |
|---|---|---|
| `--buffer` segundos guardados | `--buffer 300` (5 min) | `180` |
| `--memory` limite de RAM em MB | `--memory 4096` | calculado para o `--buffer` |
| `--output` pasta | `--output "D:/Replays"` | `~/Videos/OBS Replays` |
| `--size` tamanho da tela e do vídeo | `--size 1920x1080` | tela principal |
| `--fps` | `--fps 30` | `60` |
| `--encoder` | `nvenc-av1`, `nvenc-hevc`, `nvenc-h264`, `x264` | `auto` |
| `--quality` menor = melhor e maior | `--quality 24` | `28` |
| `--browser` (repita para vários) | `--browser firefox --browser zen` | `chrome`, `firefox` |
| `--lang` nomes das faixas e fontes | `--lang pt` | idioma do Windows |

O `auto` testa sua GPU com o FFmpeg quando ele está instalado; senão, lê o nome da placa NVIDIA. Para escolher você mesmo:

- **`nvenc-av1`** precisa de uma NVIDIA RTX série 40 ou mais nova.
- **`nvenc-hevc`** ou **`nvenc-h264`** para placas NVIDIA mais antigas.
- **`x264`** (CPU) para qualquer PC.
- **GPU AMD ou Intel:** crie o perfil com `x264` e depois escolha o encoder da sua GPU no OBS em *Configurações → Saída → Gravação*.

Exemplo: 5 minutos, 1080p, replays no disco D, Firefox e Zen, nomes em português:

```sh
python obs-setup.py --buffer 300 --size 1920x1080 --output "D:/Replays" --browser firefox --browser zen --lang pt
```

Rode o script de novo quando quiser mudar algo. A versão anterior é copiada para backup a cada vez.

## 4. Ative

### Sempre, automaticamente (recomendado)

O `obs-replay.cmd` abre o OBS com este perfil e o replay buffer já ligado.

1. Pressione **Win+R**, digite `shell:startup` e aperte Enter.
2. Na pasta que abrir, clique com o botão direito → *Novo → Atalho* e aponte para o `obs-replay.cmd`.

Agora o OBS inicia junto com o Windows, pronto para salvar replays. Você também pode dar dois cliques no `obs-replay.cmd` para abrir agora.

### Manualmente, dentro do OBS

1. Menu **Perfil** → **snip-clip Replay**.
2. Menu **Coleção de cenas** → **snip-clip Replay**.
3. Clique em **Iniciar buffer de replay** no painel *Controles*.

## 5. Confira se funciona

1. Toque algo por alguns segundos: um jogo, uma call no Discord, um vídeo no navegador.
2. Aperte **Alt+F10**. Um arquivo chamado `Replay <data> <hora>.mp4` aparece na pasta de saída.
3. Abra no snip-clip: as faixas devem aparecer pelo nome e cada uma deve tocar só o próprio áudio.

Para ver qual fonte vai para qual faixa, no OBS vá em *Editar → Propriedades avançadas de áudio*.

## Observações

- **Jogos em janela ou sem borda.** A fonte *Jogo* captura jogos em tela cheia. Os outros caem na fonte *Tela*, que fica atrás e grava o monitor inteiro. O som deles continua indo para a faixa 6, *Sistema*.
- **Replays mais longos.** Aumente o `--buffer`; o limite de memória cresce junto, cerca de 0,8 GB de RAM por minuto no bitrate máximo. No OBS você também pode mudar em *Configurações → Saída → Buffer de replay*, nos campos *Tempo máximo* e *Memória máxima*. Vale o limite que for atingido primeiro, então aumente os dois juntos.
- **Outro atalho.** Mude no OBS em *Configurações → Atalhos → Salvar replay*.
- **Desfazer.** Escolha outro perfil e outra coleção de cenas no OBS. Para restaurar uma versão anterior, feche o OBS e copie os arquivos de volta de `%APPDATA%\obs-studio\basic\backup-<data>\`:
  - a pasta `profile-snip-clip Replay` vai para `profiles\snip-clip Replay`;
  - o arquivo `.json` vai para `scenes\`.

Os nomes dos menus do OBS acima são os da interface em português e podem variar um pouco entre versões.
