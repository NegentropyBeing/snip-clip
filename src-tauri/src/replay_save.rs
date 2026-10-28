//! `snip-clip --save-replay` (FR-45): asks OBS to save its replay buffer through OBS's
//! WebSocket server (protocol v5), without opening a window. On Wayland, OBS only sees its own
//! hotkeys while focused, so a desktop shortcut runs this instead.
//!
//! A minimal client: one connection, text frames, the requests this needs. The port and password
//! come from OBS's own WebSocket settings, which installing the replay profile turned on.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;

use serde_json::{Value, json};
use sha2::{Digest, Sha256};

pub const SAVE_REPLAY_FLAG: &str = "--save-replay";
const TIMEOUT: Duration = Duration::from_secs(10);
/// Event subscription bit for output events (ReplayBufferSaved).
const OUTPUTS_EVENTS: u32 = 1 << 6;

const BASE64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        for i in 0..4 {
            out.push(if i <= chunk.len() { BASE64[(n >> (18 - 6 * i) & 63) as usize] as char } else { '=' });
        }
    }
    out
}

/// OBS's challenge-response: base64(sha256(base64(sha256(password + salt)) + challenge)).
fn auth_response(password: &str, salt: &str, challenge: &str) -> String {
    let secret = base64(&Sha256::digest(format!("{password}{salt}")));
    base64(&Sha256::digest(format!("{secret}{challenge}")))
}

/// Not cryptographic: WebSocket masking only needs to vary.
fn mask_key() -> [u8; 4] {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.subsec_nanos());
    (nanos ^ std::process::id().rotate_left(16)).to_le_bytes()
}

fn send(stream: &mut TcpStream, msg: &Value) -> std::io::Result<()> {
    let data = msg.to_string().into_bytes();
    let mut frame = vec![0x81];
    match data.len() {
        n if n < 126 => frame.push(0x80 | n as u8),
        n if n <= 0xFFFF => {
            frame.push(0x80 | 126);
            frame.extend_from_slice(&(n as u16).to_be_bytes());
        }
        n => {
            frame.push(0x80 | 127);
            frame.extend_from_slice(&(n as u64).to_be_bytes());
        }
    }
    let mask = mask_key();
    frame.extend_from_slice(&mask);
    frame.extend(data.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
    stream.write_all(&frame)
}

/// Next text message as JSON; answers pings, turns a close frame into an error.
fn receive(reader: &mut BufReader<TcpStream>) -> Result<Value, String> {
    loop {
        let mut head = [0u8; 2];
        reader.read_exact(&mut head).map_err(|_| "OBS closed the connection".to_string())?;
        let opcode = head[0] & 0x0F;
        let mut len = u64::from(head[1] & 0x7F);
        if len == 126 {
            let mut b = [0u8; 2];
            reader.read_exact(&mut b).map_err(|e| e.to_string())?;
            len = u64::from(u16::from_be_bytes(b));
        } else if len == 127 {
            let mut b = [0u8; 8];
            reader.read_exact(&mut b).map_err(|e| e.to_string())?;
            len = u64::from_be_bytes(b);
        }
        let mut data = vec![0u8; len as usize];
        reader.read_exact(&mut data).map_err(|e| e.to_string())?;
        match opcode {
            1 => return serde_json::from_slice(&data).map_err(|e| e.to_string()),
            8 => {
                let reason = String::from_utf8_lossy(data.get(2..).unwrap_or_default()).into_owned();
                return Err(if reason.is_empty() { "OBS closed the connection".into() } else { reason });
            }
            9 => {
                let mut pong = vec![0x8A, 0x80];
                pong.extend_from_slice(&mask_key());
                reader.get_mut().write_all(&pong).map_err(|e| e.to_string())?;
            }
            _ => {}
        }
    }
}

/// Saves the replay through the server at `port`; returns the saved file's path.
pub fn save_replay_at(port: u16, password: &str) -> Result<String, String> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, TIMEOUT).map_err(|_| "OBS is not running".to_string())?;
    stream.set_read_timeout(Some(TIMEOUT)).map_err(|e| e.to_string())?;
    let key = base64(&mask_key().repeat(4));
    let request = format!(
        "GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\
         Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: obswebsocket.json\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut status = String::new();
    reader.read_line(&mut status).map_err(|e| e.to_string())?;
    if !status.contains(" 101 ") {
        return Err(format!("port {port} is not OBS's WebSocket server"));
    }
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 || line == "\r\n" {
            break;
        }
    }

    let hello = receive(&mut reader)?;
    let mut identify = json!({ "rpcVersion": 1, "eventSubscriptions": OUTPUTS_EVENTS });
    if let Some(auth) = hello["d"].get("authentication") {
        let (salt, challenge) = (auth["salt"].as_str().unwrap_or_default(), auth["challenge"].as_str().unwrap_or_default());
        identify["authentication"] = json!(auth_response(password, salt, challenge));
    }
    send(&mut stream, &json!({ "op": 1, "d": identify })).map_err(|e| e.to_string())?;
    while receive(&mut reader)?["op"] != 2 {}

    send(&mut stream, &json!({ "op": 6, "d": { "requestType": "SaveReplayBuffer", "requestId": "save" } })).map_err(|e| e.to_string())?;
    loop {
        let msg = receive(&mut reader)?;
        let d = &msg["d"];
        if msg["op"] == 7 && d["requestStatus"]["result"] == false {
            return Err(d["requestStatus"]["comment"].as_str().unwrap_or("OBS could not save the replay").to_string());
        }
        if msg["op"] == 5 && d["eventType"] == "ReplayBufferSaved" {
            return Ok(d["eventData"]["savedReplayPath"].as_str().unwrap_or_default().to_string());
        }
    }
}

/// Reads the port and password from OBS's settings, then saves the replay.
pub fn save_replay() -> Result<String, String> {
    let text = crate::obs::read_websocket_config()?.ok_or("OBS's WebSocket server is not set up; install the replay profile in snip-clip")?;
    let conf: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if conf["server_enabled"] != true {
        return Err("OBS's WebSocket server is off; install the replay profile again in snip-clip".into());
    }
    let port = conf["server_port"].as_u64().and_then(|p| u16::try_from(p).ok()).unwrap_or(4455);
    save_replay_at(port, conf["server_password"].as_str().unwrap_or_default())
}

/// Desktop notification with the result (Linux, through notify-send when installed).
pub fn notify(result: &Result<String, String>) {
    let pt = ["LC_ALL", "LC_MESSAGES", "LANG"]
        .iter()
        .find_map(|v| std::env::var(v).ok().filter(|s| !s.is_empty()))
        .is_some_and(|l| l.starts_with("pt"));
    let (title, body) = match result {
        Ok(path) => (
            if pt { "Replay salvo" } else { "Replay saved" },
            std::path::Path::new(path).file_name().map_or_else(|| path.clone(), |n| n.to_string_lossy().into_owned()),
        ),
        Err(e) => (if pt { "Não foi possível salvar o replay" } else { "Could not save the replay" }, e.clone()),
    };
    eprintln!("{title}: {body}");
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("notify-send").args(["-a", "snip-clip", "-t", "3000", title, &body]).status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn encodes_base64() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }

    /// Example from the obs-websocket protocol documentation.
    #[test]
    fn answers_the_auth_challenge() {
        assert_eq!(
            auth_response("supersecretpassword", "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=", "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY="),
            "1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4="
        );
    }

    fn frame(msg: &Value) -> Vec<u8> {
        let data = msg.to_string().into_bytes();
        let mut f = vec![0x81];
        if data.len() < 126 {
            f.push(data.len() as u8);
        } else {
            f.push(126);
            f.extend_from_slice(&(data.len() as u16).to_be_bytes());
        }
        f.extend(data);
        f
    }

    fn read_client(reader: &mut BufReader<TcpStream>) -> Value {
        let mut head = [0u8; 2];
        reader.read_exact(&mut head).unwrap();
        assert_eq!(head[1] & 0x80, 0x80, "client frames are masked");
        let mut len = usize::from(head[1] & 0x7F);
        if len == 126 {
            let mut b = [0u8; 2];
            reader.read_exact(&mut b).unwrap();
            len = usize::from(u16::from_be_bytes(b));
        }
        let mut mask = [0u8; 4];
        reader.read_exact(&mut mask).unwrap();
        let mut data = vec![0u8; len];
        reader.read_exact(&mut data).unwrap();
        serde_json::from_slice(&data.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]).collect::<Vec<_>>()).unwrap()
    }

    /// A fake OBS: handshake, Hello with a challenge, a ping, then the request and the event.
    fn fake_obs(password: &'static str, buffer_on: bool) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            while reader.read_line(&mut line).unwrap() > 0 && !line.ends_with("\r\n\r\n") {}
            let (salt, challenge) = ("c2FsdA==", "Y2hhbGxlbmdl");
            let mut out = b"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n".to_vec();
            out.extend(frame(&json!({ "op": 0, "d": { "rpcVersion": 1, "authentication": { "salt": salt, "challenge": challenge } } })));
            stream.write_all(&out).unwrap();
            let identify = read_client(&mut reader);
            if identify["d"]["authentication"] != auth_response(password, salt, challenge) {
                let mut close = vec![0x88, 24, 0x0F, 0xA9];
                close.extend_from_slice(b"Authentication failed.");
                stream.write_all(&close).unwrap();
                return;
            }
            assert_eq!(identify["d"]["eventSubscriptions"], OUTPUTS_EVENTS);
            stream.write_all(&frame(&json!({ "op": 2, "d": { "negotiatedRpcVersion": 1 } }))).unwrap();
            let request = read_client(&mut reader);
            assert_eq!(request["d"]["requestType"], "SaveReplayBuffer");
            stream.write_all(&[0x89, 0]).unwrap();
            let status = if buffer_on { json!({ "result": true, "code": 100 }) } else { json!({ "result": false, "code": 604, "comment": "Replay buffer is not active." }) };
            stream.write_all(&frame(&json!({ "op": 7, "d": { "requestId": "save", "requestStatus": status } }))).unwrap();
            if buffer_on {
                let long = "x".repeat(300);
                stream.write_all(&frame(&json!({ "op": 5, "d": { "eventType": "Other", "eventData": { "pad": long } } }))).unwrap();
                stream.write_all(&frame(&json!({ "op": 5, "d": { "eventType": "ReplayBufferSaved", "eventData": { "savedReplayPath": "/v/Replay 1.mkv" } } }))).unwrap();
            }
            let mut rest = Vec::new();
            let _ = reader.read_to_end(&mut rest);
        });
        port
    }

    #[test]
    fn saves_the_replay() {
        assert_eq!(save_replay_at(fake_obs("pw", true), "pw").unwrap(), "/v/Replay 1.mkv");
    }

    #[test]
    fn reports_obs_errors() {
        assert_eq!(save_replay_at(fake_obs("pw", false), "pw").unwrap_err(), "Replay buffer is not active.");
        assert_eq!(save_replay_at(fake_obs("pw", true), "wrong").unwrap_err(), "Authentication failed.");
    }

    #[test]
    fn reports_obs_not_running() {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert_eq!(save_replay_at(port, "pw").unwrap_err(), "OBS is not running");
    }
}
