"""Tests for Supabase client error formatting."""

from backend.supabase_client import format_supabase_network_error


def test_supabase_network_error_explains_windows_socket_block() -> None:
    message = format_supabase_network_error(
        "[WinError 10013] An attempt was made to access a socket "
        "in a way forbidden by its access permissions"
    )

    assert message == (
        "Supabase network access blocked: Windows refused the outbound "
        "socket connection. Check firewall, antivirus, VPN, or sandbox "
        "network permissions before rerunning the optimizer."
    )
