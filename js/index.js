"use strict";

const OGG_HEADER_LENGTH = "data:audio/ogg;base64,".length;

const AudioContext = window.AudioContext || window.webkitAudioContext;

const fetchJSON = (path, opts = {}) => {
  return window.fetch(path, opts).then((response) => {
    if (response.ok) {
      return response.json();
    } else {
      // fetch does not reject on HTTP error, so we do this manually.
      throw new Error("Unexpected HTTP status code " + response.status);
    }
  });
};

const hideElement = (element) => {
  element.style.visibility = "hidden";
};

const showElement = (element) => {
  element.style.visibility = "visible";
};

const setElementText = (element, text) => {
  element.textContent = text;
};

class Base64Decoder {
  constructor() {
    this.keyStr =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  }

  removePaddingChars(input) {
    for (let i = input.length - 1; i >= 0; --i) {
      if (input.charAt(i) !== "=") {
        return input.substring(0, i + 1);
      }
    }
    // input.length === 0
    return input;
  }

  decode(input) {
    input = input.replace(/[^A-Za-z0-9+/=]/g, "");
    input = this.removePaddingChars(input);
    const bytes = input.length / 4 * 3;

    const buffer = new ArrayBuffer(bytes);
    const uarray = new Uint8Array(buffer);
    let chr1, chr2, chr3;
    let enc1, enc2, enc3, enc4;
    let j = 0;

    for (let i = 0; i < bytes; i += 3) {
      enc1 = this.keyStr.indexOf(input.charAt(j++));
      enc2 = this.keyStr.indexOf(input.charAt(j++));
      enc3 = this.keyStr.indexOf(input.charAt(j++));
      enc4 = this.keyStr.indexOf(input.charAt(j++));

      chr1 = (enc1 << 2) | (enc2 >> 4);
      chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      chr3 = ((enc3 & 3) << 6) | enc4;

      uarray[i] = chr1;
      if (enc3 !== 64) {
        uarray[i + 1] = chr2;
      }
      if (enc4 !== 64) {
        uarray[i + 2] = chr3;
      }
    }

    return buffer;
  }

  decodeAsync(input) {
    return new Promise((resolve, reject) => {
      // Use setTimeout to kick task to the last of event loop.
      window.setTimeout(() => {
        resolve(this.decode(input));
      }, 0);
    });
  }
}

class AudioPlayer {
  constructor(opts = {}) {
    this.context = new AudioContext();
    this.gainNode = this.context.createGain();
    // Our default MIDI piano volume is too low so use 10 as gain.
    this.gainNode.gain.value = 10;
    this.gainNode.connect(this.context.destination);
    this.sources = {};
    this.stopDelay = opts.stopDelay || 0.3;
    this.decodeAudioData = this.context.decodeAudioData.bind(this.context);
  }

  play(id, buffer) {
    if (this.sources[id] != null) {
      return;
    }
    this.sources[id] = this.context.createBufferSource();
    this.sources[id].buffer = buffer;
    this.sources[id].connect(this.gainNode);
    this.sources[id].start(this.context.currentTime);
  }

  pause(id) {
    if (this.sources[id] == null) {
      return;
    }
    this.sources[id].stop(this.context.currentTime + this.stopDelay);
    delete this.sources[id];
  }

  pauseAll() {
    for (const id in this.sources) {
      this.pause(id);
    }
  }
}

class JSONAsset {
  constructor(path) {
    this.path = path;
    this.json = null;
    this.error = null;
  }

  loadAsync(onStart, onLoad, onError) {
    if (onStart != null) {
      onStart(this);
    }
    return fetchJSON(this.path).then((json) => {
      this.json = json;
      if (onLoad != null) {
        onLoad(this);
      }
    }).catch((error) => {
      this.error = error;
      console.error(error);
      if (onError != null) {
        onError(this);
      }
    });
  }
}

class AudioAsset extends JSONAsset {
  loadAsync(player, decoder, onStart, onLoad, onError) {
    if (onStart != null) {
      onStart(this);
    }
    return fetchJSON(this.path).then((json) => {
      this.json = json;
      const promises = [];
      for (const k in this.json) {
        decoder.decodeAsync(
          this.json[k].substring(OGG_HEADER_LENGTH)
        ).then((buffer) => {
          return player.decodeAudioData(buffer);
        }).then((audioBuffer) => {
          this.json[k] = audioBuffer;
        });
        promises.push(this.json[k]);
      }
      return Promise.all(promises);
    }).then((promises) => {
      if (onLoad != null) {
        onLoad(this);
      }
    }).catch((error) => {
      this.error = error;
      console.error(error);
      if (onError != null) {
        onError(this);
      }
    });
  }
}

class Keyboard {
  constructor(app, codesChars, notesDigits, layoutAsset) {
    this.app = app;
    this.container = document.getElementById("keyboard");
    this.codesChars = codesChars;
    this.notesDigits = notesDigits;
    this.layoutAsset = layoutAsset;
    this.keys = {};
    this._ = {};
  }

  press(code) {
    if (this._[code]) {
      return;
    }
    this._[code] = true;
    this.keys[code].classList.add("key-pressed");
  }

  release(code) {
    if (this._[code] == null || !this._[code]) {
      return;
    }
    this._[code] = false;
    this.keys[code].classList.remove("key-pressed");
    delete this._[code];
  }

  releaseAll() {
    for (const code in this._) {
      this.release(code);
    }
  }

  createKey(key, x, y, length) {
    let upper = this.codesChars.json[key[0]];
    if (this.app.settings.params.layout === "jp") {
      switch (key[0]) {
        case "Equal":
          upper = "^";
          break;
        case "BracketLeft":
          upper = "@";
          break;
        case "Quote":
          upper = ":";
          break;
        case "Backslash":
          upper = "]";
          break;
        default:
          break;
      }
    }
    const lower = this.app.settings.params.display === "digit"
      ? this.notesDigits.json[key[1]]
      : key[1];
    const element = document.createElement("div");
    element.className = "card key center";
    /**
     * I know this is too long, this is too simple, and this is too stupid.
     * But it is clear to see which key takes how much space.
     * I can merge some same length key, but if one day they need to change,
     * it is hard because I need to take them apart with copy & paste.
     */
    if (x === 0 && y === length - 1) {
      if (this.app.settings.params.layout === "hhkb" ||
        this.app.settings.params.layout === "jp") {
        // Backquote or JP Backspace.
        element.classList.add("flex-item-4");
      } else {
        // Normal Backspace.
        element.classList.add("flex-item-8");
      }
    } else if (x === 1 && y === 0) {
      // Tab.
      element.classList.add("flex-item-6");
    } else if (x === 1 && y === length - 1) {
      if (this.app.settings.params.layout === "jp") {
        // Enter.
        element.classList.add("flex-item-6");
      } else {
        // Backslash.
        element.classList.add("flex-item-6");
      }
    } else if (x === 2 && y === 0) {
      // CapsLock.
      element.classList.add("flex-item-7");
    } else if (x === 2 && y === length - 1) {
      // Enter.
      if (this.app.settings.params.layout === "jp") {
        element.classList.add("flex-item-5");
      } else {
        element.classList.add("flex-item-9");
      }
    } else if (x === 3 && y === 0) {
      // ShiftLeft.
      element.classList.add("flex-item-9");
    } else if (x === 3 && y === length - 1) {
      // ShiftRight.
      if (this.app.settings.params.layout === "jp") {
        element.classList.add("flex-item-7");
      } else {
        element.classList.add("flex-item-11");
      }
    } else if (x === 4) {
      // Space.
      element.classList.add("flex-item-24");
    } else {
      // Other digit, alpha and symbol.
      element.classList.add("flex-item-4");
    }
    element.id = key[0];
    element.innerHTML = `${upper}<br>${lower}`;
    this.keys[key[0]] = element;
    return element;
  }

  createRow(row, x) {
    const element = document.createElement("div");
    element.className = "flex-row keyboard-row";
    for (let y = 0; y < row.length; ++y) {
      element.appendChild(this.createKey(row[y], x, y, row.length));
    }
    return element;
  }

  render() {
    this.container.innerHTML = "";
    for (let x = 0; x < this.layoutAsset.json.length; ++x) {
      this.container.appendChild(this.createRow(this.layoutAsset.json[x], x));
    }
  }
}

class Logger {
  constructor(app) {
    this.app = app;
    this.textarea = document.getElementById("logger-textarea");
    this.switchCheckbox = document.getElementById("checkbox-switch");
    this.spaceButton = document.getElementById("button-space");
    this.returnButton = document.getElementById("button-return");
    this.deleteButton = document.getElementById("button-delete");
    this.clearButton = document.getElementById("button-clear");
    this.copyButton = document.getElementById("button-copy");
    this.enabled = true;
    this._ = [];
    this.switchCheckbox.addEventListener("change", this.switch.bind(this));
    this.spaceButton.addEventListener("click", this.space.bind(this));
    this.returnButton.addEventListener("click", this.return.bind(this));
    this.deleteButton.addEventListener("click", this.delete.bind(this));
    this.clearButton.addEventListener("click", this.clear.bind(this));
    this.copyButton.addEventListener("click", this.copy.bind(this));
  }

  import(string) {
    if (string != null) {
      this._ = JSON.parse(string);
    }
  }

  export() {
    return JSON.stringify(this._);
  }

  join() {
    return this._.join(
      this.app.settings.params.output === "digit" ? "" : " "
    );
  }

  switch(event) {
    // TODO: Need test: will set checked generates event?
    if (event == null) {
      this.switchCheckbox.checked = !this.switchCheckbox.checked;
    } else {
      this.enabled = event.target.checked;
    }
  }

  space() {
    if (this.enabled) {
      this._.push(" ");
      this.render();
    }
  }

  return() {
    if (this.enabled) {
      this._.push("\n");
      this.render();
    }
  }

  delete() {
    if (this.enabled) {
      this._.pop();
      this.render();
    }
  }

  clear() {
    if (this.enabled) {
      this._ = [];
      this.render();
    }
  }

  insert(text) {
    if (this.enabled) {
      this._.push(text);
      this.render();
    }
  }

  copy() {
    const dummy = document.createElement("textarea");
    document.body.appendChild(dummy);
    dummy.value = this.join();
    dummy.select();
    document.execCommand("copy");
    document.body.removeChild(dummy);
  }

  render() {
    // Add a cursor so we know where we are.
    this.textarea.value = `${this.join()}_`;
    this.textarea.scrollTop = this.textarea.scrollHeight;
  }
}

class Settings {
  constructor(app) {
    this.app = app;
    this.searchParams = new URLSearchParams(window.location.search);
    this.displaySelect = document.getElementById("select-display");
    this.displayOptions = Array.from(this.displaySelect.options).map((o) => {
      return o.label;
    });
    this.displaySelect.addEventListener(
      "input",
      this.onDisplayInput.bind(this)
    );
    this.outputSelect = document.getElementById("select-output");
    this.outputOptions = Array.from(this.outputSelect.options).map((o) => {
      return o.label;
    });
    this.outputSelect.addEventListener(
      "input",
      this.onOutputInput.bind(this)
    );
    this.layoutSelect = document.getElementById("select-layout");
    this.layoutOptions = Array.from(this.layoutSelect.options).map((o) => {
      return o.label;
    });
    this.layoutSelect.addEventListener(
      "input",
      this.onLayoutInput.bind(this)
    );
    this.params = {
      "display": this.searchParams.has("display") &&
        this.displayOptions.indexOf(this.searchParams.get("display")) !== -1
        ? this.searchParams.get("display")
        : "digit",
      "output": this.searchParams.has("output") &&
        this.outputOptions.indexOf(this.searchParams.get("output")) !== -1
        ? this.searchParams.get("output")
        : "digit",
      "layout": this.searchParams.has("layout") &&
        this.layoutOptions.indexOf(this.searchParams.get("layout")) !== -1
        ? this.searchParams.get("layout")
        : "default"
    };
  }

  updateQueryString() {
    const newPath = [
      window.location.protocol,
      "//",
      window.location.host,
      window.location.pathname,
      "?",
      this.searchParams.toString()
    ].join("");
    window.history.replaceState({"path": newPath}, "", newPath);
  }

  onDisplayInput(event) {
    const option = this.displayOptions[this.displaySelect.selectedIndex];
    this.params.display = option;
    this.searchParams.set("display", option);
    this.updateQueryString();
    this.app.keyboard = new Keyboard(
      this.app,
      this.app.codesChars,
      this.app.notesDigits,
      this.app.keyboardLayouts[this.params.layout]
    );
    this.app.updateKeyboardLayout();
    this.app.keyboard.render();
  }

  onOutputInput(event) {
    const option = this.outputOptions[this.outputSelect.selectedIndex];
    this.params.output = option;
    this.searchParams.set("output", option);
    this.updateQueryString();
  }

  onLayoutInput(event) {
    const option = this.layoutOptions[this.layoutSelect.selectedIndex];
    this.params.layout = option;
    this.searchParams.set("layout", option);
    this.updateQueryString();
    this.app.keyboard = new Keyboard(
      this.app,
      this.app.codesChars,
      this.app.notesDigits,
      this.app.keyboardLayouts[this.params.layout]
    );
    this.app.updateKeyboardLayout();
    this.app.keyboard.render();
  }
}

class App {
  constructor() {
    this.dialogMask = document.getElementById("mask-dialog");
    this.waitingCard = document.getElementById("card-waiting");
    this.loadingCard = document.getElementById("card-loading");
    hideElement(this.loadingCard);
    showElement(this.waitingCard);
    showElement(this.dialogMask);
    this.waitingButton = document.getElementById("button-waiting");
    this.totalText = document.getElementById("total");
    this.loadedText = document.getElementById("loaded");
    this.errorText = document.getElementById("error");
    hideElement(this.errorText);
    this.keyboardLayouts = {
      "default": new JSONAsset("assets/layouts/default.json"),
      "ctrlcaps": new JSONAsset("assets/layouts/ctrlcaps.json"),
      "hhkb": new JSONAsset("assets/layouts/hhkb.json"),
      "jp": new JSONAsset("assets/layouts/jp.json"),
      "dvorak": new JSONAsset("assets/layouts/dvorak.json")
    };
    // We can only create AudioContext after user action in Chromium.
    this.player = null;
    this.decoder = new Base64Decoder();
    this.notesBuffers = new AudioAsset("assets/notes-buffers.json");
    this.notesDigits = new JSONAsset("assets/notes-digits.json");
    this.notesLily = new JSONAsset("assets/notes-lily.json");
    this.codesChars = new JSONAsset("assets/codes-chars.json");
    this.state = App.WAITING;
    this.settings = new Settings(this);
    this.logger = new Logger(this);
    this.logger.import(window.localStorage.getItem("log"));
    this.keyboard = new Keyboard(
      this,
      this.codesChars,
      this.notesDigits,
      this.keyboardLayouts[this.settings.params.layout]
    );
    this.waitingButton.addEventListener("click", this.start.bind(this));
  }

  updateKeyboardLayout() {
    this.codesNotes = {};
    for (const row of this.keyboardLayouts[this.settings.params.layout].json) {
      for (const key of row) {
        this.codesNotes[key[0]] = key[1];
      }
    }
  }

  loadAssetsAsync() {
    let loaded = 0;
    const onLoad = (asset) => {
      setElementText(this.loadedText, `${++loaded}`);
    };
    const onError = (asset) => {
      setElementText(this.errorText, `${asset.error}`);
      showElement(this.errorText);
    };
    const assets = [
      this.notesBuffers.loadAsync(
        this.player,
        this.decoder,
        null,
        onLoad,
        onError
      ),
      this.notesDigits.loadAsync(null, onLoad, onError),
      this.notesLily.loadAsync(null, onLoad, onError),
      this.codesChars.loadAsync(null, onLoad, onError)
    ].concat(
      Object.values(this.keyboardLayouts).map((asset) => {
        return asset.loadAsync(null, onLoad, onError);
      })
    );
    setElementText(this.totalText, `${assets.length}`);
    return Promise.all(assets);
  }

  onVisibilityChange(event) {
    if (this.state !== App.RUNNING) {
      return;
    }
    // Typically no keyup event is send when user switch tabs.
    // So we clear state manually.
    if (document.visibilityState !== "visible") {
      this.player.pauseAll();
      this.keyboard.releaseAll();
    }
  }

  onKeyDown(event) {
    event.preventDefault();

    if (this.state === App.WAITING) {
      this.start();
      return;
    }

    if (this.state !== App.RUNNING) {
      return;
    }

    switch (event.code) {
      case "ArrowRight":
        this.logger.space();
        return;
      case "ArrowDown":
        this.logger.return();
        return;
      case "ArrowLeft":
        this.logger.delete();
        return;
      // I got crazy after I deleted my input twice by mistake!
      // case "ArrowUp":
      //   this.logger.clear();
      //   return;
      default:
        break;
    }

    if (event.repeat || this.codesNotes[event.code] == null) {
      return;
    }

    const code = event.code;
    const note = this.codesNotes[code];
    this.keyboard.press(code);
    this.logger.insert(
      this.settings.params.output === "digit"
        ? this.notesDigits.json[note]
        : this.notesLily.json[
          this.settings.params.output
        ][note]
    );
    window.localStorage.setItem("log", this.logger.export());
    this.player.play(note, this.notesBuffers.json[note]);
  }

  onKeyUp(event) {
    event.preventDefault();

    if (this.state !== App.RUNNING) {
      return;
    }

    if (event.repeat || this.codesNotes[event.code] == null) {
      return;
    }

    const code = event.code;
    const note = this.codesNotes[code];
    this.keyboard.release(code);
    this.player.pause(note);
  }

  run() {
    document.addEventListener(
      "visibilitychange",
      this.onVisibilityChange.bind(this)
    );
    document.addEventListener("keydown", this.onKeyDown.bind(this));
    document.addEventListener("keyup", this.onKeyUp.bind(this));
  }

  start() {
    this.player = new AudioPlayer();
    this.state = App.LOADING;
    hideElement(this.waitingCard);
    showElement(this.loadingCard);
    showElement(this.dialogMask);
    this.loadAssetsAsync().then(() => {
      hideElement(this.loadingCard);
      hideElement(this.waitingCard);
      hideElement(this.dialogMask);
      this.updateKeyboardLayout();
      this.render();
      this.state = App.RUNNING;
    });
  }

  render() {
    this.keyboard.render();
    this.logger.render();
  }
}

App.WAITING = 1;
App.LOADING = 2;
App.RUNNING = 3;

const documentReady = (callback) => {
  if (callback == null) {
    return;
  }
  if (
    document.readyState === "complete" || document.readyState === "interactive"
  ) {
    window.setTimeout(callback, 0);
  } else {
    document.addEventListener("DOMContentLoaded", callback);
  }
};

documentReady(() => {
  const app = new App();
  app.run();
});
