"""Serve the existing Vercel optimizer handlers on loopback for local development."""

from api.optimizer.health import optimizer_health
from api.optimizer.run import app
from werkzeug.serving import make_server


app.add_url_rule("/api/optimizer/health", view_func=optimizer_health, methods=["GET"])


def main() -> None:
    # Bind before reporting readiness so a port conflict fails before Next starts.
    server = make_server("127.0.0.1", 8000, app, threaded=True)
    print("OPTIMIZER_READY http://127.0.0.1:8000", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
