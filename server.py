elif action == "pass":
    if room.current_player().pid != pid:
        await ws.send_json({"type": "error", "msg": "Not your turn."})
        continue

    room.push_log(f"✅ {player.name} passes.")
    room.advance_turn(skip_empty=True)
    await broadcast_state(room)
