# Perfil de replay do OBS — como instalar e usar

[English](README.md) · **Português**

Isto configura o OBS Studio no Windows e no Linux como um gravador de "replay instantâneo" sempre ligado: os últimos minutos ficam na memória e são salvos num arquivo quando você aperta **Alt+F10**. Cada fonte de áudio ganha uma faixa própria com nome, então no snip-clip você pode tirar o Discord ou o navegador de um clipe, ou abaixar o microfone.

| Faixa | Nome | Conteúdo |
|---|---|---|
| 1 | Mix | Jogo + Discord + navegador + microfone |
| 2 | Jogo | Áudio da captura de jogo |
| 3 | Discord | Só o app do Discord |
| 4 | Navegador | Os navegadores que você escolher |
| 5 | Microfone | Microfone padrão |
| 6 | Sistema (tudo) | Tudo o que o PC toca (reserva, caso alguma fonte escape) |

Os nomes acima são os da versão em português (`--lang pt`). Por padrão o script segue o idioma do sistema.

Os passos abaixo são para o Windows. No Linux, siga-os com as mudanças da seção [Linux](#linux).

## 1. Antes de começar

- **Instale o OBS Studio** pelo [obsproject.com](https://obsproject.com/), ou rode `winget install OBSProject.OBSStudio`.
- **Instale o Python 3** pelo [python.org](https://www.python.org/downloads/) (marque *Add python.exe to PATH*), ou rode `winget install Python.Python.3.12`.
- **Desligue o NVIDIA Instant Replay (ShadowPlay).** Ele também salva com Alt+F10, e com os dois ligados o uso de RAM e de encoder da GPU dobra. No app da NVIDIA, pressione **Alt+Z** e desligue o **Instant Replay**. No GeForce Experience a opção fica no mesmo overlay do Alt+Z.
- **Feche o OBS.** Ele regrava as configurações ao sair, então mudanças feitas com ele aberto se perdem.

## 2. Baixe os arquivos

Baixe este repositório (botão verde **Code** → **Download ZIP**) e extraia, ou clone com git. Você só precisa dos arquivos em `extras/obs/`.

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
- replays salvos em MKV em `Vídeos\OBS Replays` (o MKV guarda os nomes das faixas, o MP4 descarta)
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
| `--encoder` | `nvenc-av1`, `nvenc-hevc`, `nvenc-h264`, `x264` (no Linux também `vaapi-av1`, `vaapi-hevc`, `vaapi-h264`) | `auto` |
| `--quality` menor = melhor e maior | `--quality 24` | `28` |
| `--browser` (repita para vários) | `--browser firefox --browser zen` | `chrome`, `firefox` |
| `--lang` nomes das faixas e fontes | `--lang pt` | idioma do sistema |
| `--app-audio` (Linux) faixas Jogo, Discord e Navegador | `on`, `off` | `auto`: ligado se o plugin estiver instalado |

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
2. Aperte **Alt+F10**. Um arquivo chamado `Replay <data> <hora>.mkv` aparece na pasta de saída.
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

## Linux

Tudo o que está acima vale, com estas mudanças. Você precisa do OBS 31 ou mais novo e do PipeWire, no X11 ou no Wayland.

### Antes de começar

- **Instale o OBS Studio, o Python 3 e o FFmpeg** pela sua distribuição (o FFmpeg só é usado para testar os encoders da GPU), ou o OBS pelo Flathub: `flatpak install flathub com.obsproject.Studio`. Se os dois estiverem instalados, o script configura o OBS nativo.
- **Instale o plugin [obs-pipewire-audio-capture](https://github.com/dimtpap/obs-pipewire-audio-capture)** para as faixas Jogo, Discord e Navegador. No Linux, o OBS sozinho não captura o áudio de um app específico.
  - OBS do Flatpak: `flatpak install flathub com.obsproject.Studio.Plugin.PipeWireAudioCapture`
  - OBS nativo: extraia o arquivo da última versão do plugin em `~/.config/obs-studio/plugins/`.

  Sem ele o perfil funciona do mesmo jeito, com três faixas: Mix (sistema + microfone), Microfone e Sistema.

### Crie o perfil

```sh
cd extras/obs
python3 obs-setup.py --lang pt
```

O que muda em relação ao Windows:

- **Tela.** No X11 é usada a *Captura de tela (XSHM)* da primeira tela. No Wayland, a *Captura de tela (PipeWire)*: na primeira vez que o OBS abre, ele pergunta qual tela compartilhar. Escolha e permita que a escolha seja lembrada.
- **Faixa Jogo.** Não existe captura de jogo no Linux, então a faixa *Jogo* recebe todos os apps **menos** o Discord, os navegadores e o OBS. Sons de notificação de outros apps também caem nela.
- **Encoder.** O `auto` também testa o VAAPI (GPUs AMD e Intel) depois do NVENC: AV1, depois HEVC, depois H.264. O VAAPI usa QP constante (`--quality` menos 5).
- **Replays** vão para a sua pasta de vídeos (`xdg-user-dir VIDEOS`), em `OBS Replays`.
- **Backups** vão para `~/.config/obs-studio/basic/backup-<data>/`, ou `~/.var/app/com.obsproject.Studio/config/obs-studio/basic/backup-<data>/` no Flatpak.

### Salvar com Alt+F10 no Wayland

No Wayland, o OBS só recebe atalhos com a janela dele em foco, então o Alt+F10 não faz nada durante um jogo. No X11 funciona como no Windows.

No Wayland, o `obs-setup.py` liga o servidor WebSocket que vem com o OBS (porta 4455, com uma senha gerada por ele; uma senha que já exista é mantida). O `obs-save-replay.py` usa esse servidor para salvar o replay e mostra uma notificação. Ligue-o ao Alt+F10 no seu ambiente gráfico:

- **GNOME:** *Configurações → Teclado → Ver e personalizar atalhos → Atalhos personalizados → +*. Comando: `python3 /caminho/completo/para/extras/obs/obs-save-replay.py`. O GNOME já usa Alt+F10 para maximizar janelas: libere em *Janelas → Alternar estado de maximização*, ou escolha outra tecla.
- **KDE Plasma:** *Configurações do sistema → Teclado → Atalhos → Adicionar novo → Comando ou script*, mesmo comando.

O servidor escuta em todas as interfaces de rede; a senha o protege. Para desligar, vá no OBS em *Ferramentas → Configurações do servidor WebSocket*.

### Ative sempre

O `obs-replay.sh` abre o OBS (o nativo, senão o do Flatpak) com este perfil e o replay buffer já ligado. Para abrir ao entrar na sessão, rode isto em `extras/obs/`:

```sh
chmod +x obs-replay.sh
mkdir -p ~/.config/autostart
cat > ~/.config/autostart/snip-clip-replay.desktop <<EOF
[Desktop Entry]
Type=Application
Name=OBS replay (snip-clip)
Exec="$PWD/obs-replay.sh"
EOF
```

Você também pode rodar `./obs-replay.sh` para abrir agora.
