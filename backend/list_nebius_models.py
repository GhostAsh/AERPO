"""Prints available Nebius model IDs for the configured API key."""

from __future__ import annotations

from backend.nebius_client import NebiusClient


def main() -> None:
    """Lists model IDs without printing secrets or making completions."""

    for model_id in NebiusClient().list_models():
        print(model_id)


if __name__ == "__main__":
    main()
