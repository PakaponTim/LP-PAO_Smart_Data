(function () {
  function createSocket(url, opts) {
    var listeners = {};
    var lastSeq = -1;
    var connected = false;
    var polling = false;
    var closed = false;

    function emitLocal(event, payload) {
      var list = listeners[event] || [];
      for (var i = 0; i < list.length; i++) {
        try {
          list[i](payload);
        } catch (err) {
          console.error('[Socket.IO-7000]', err);
        }
      }
    }

    async function poll() {
      if (closed || polling) return;
      polling = true;
      try {
        var res = await window.fetch('./endpoint.php?r=' + encodeURIComponent('/socket.io/?EIO=4&transport=polling&seq=' + lastSeq), {
          method: 'GET',
          cache: 'no-store'
        });
        if (res.ok) {
          var data = await res.json();
          if (!connected) {
            connected = true;
            socket.connected = true;
            emitLocal('connect');
          }
          if (typeof data.seq === 'number') {
            if (lastSeq === -1) {
              // On first connect, set cursor to current seq so we only stream new real-time events
              // (historical logs are already loaded via /api/status)
              lastSeq = data.seq;
            } else if (Array.isArray(data.events)) {
              for (var i = 0; i < data.events.length; i++) {
                var ev = data.events[i];
                if (ev && ev.seq > lastSeq) {
                  lastSeq = ev.seq;
                  emitLocal(ev.event || 'server_log', ev.data);
                }
              }
            }
          }
        }
      } catch (err) {
        if (connected) {
          connected = false;
          socket.connected = false;
          emitLocal('disconnect');
        }
      } finally {
        polling = false;
      }
    }

    var timer = setInterval(poll, 1200);
    setTimeout(poll, 100);

    var socket = {
      id: 'php7000-' + Math.random().toString(36).slice(2, 10),
      connected: true,
      on: function (event, cb) {
        if (!listeners[event]) listeners[event] = [];
        listeners[event].push(cb);
        return socket;
      },
      off: function (event, cb) {
        if (!listeners[event]) return socket;
        if (!cb) {
          delete listeners[event];
        } else {
          listeners[event] = listeners[event].filter(function (fn) { return fn !== cb; });
        }
        return socket;
      },
      emit: function (event, data) {
        window.fetch('./endpoint.php?r=' + encodeURIComponent('/socket.io/?EIO=4&transport=polling'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: event, data: data })
        }).catch(function () {});
        return socket;
      },
      disconnect: function () {
        closed = true;
        clearInterval(timer);
        socket.connected = false;
        emitLocal('disconnect');
      },
      close: function () {
        this.disconnect();
      }
    };

    return socket;
  }

  window.io = function (url, opts) {
    return createSocket(url, opts);
  };
})();

