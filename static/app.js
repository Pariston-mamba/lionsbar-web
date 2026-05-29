let ws;

function log(msg){
    document.getElementById("log").innerHTML += `<div>${msg}</div>`;
}

function join(){
    const room = document.getElementById("room").value;
    const name = document.getElementById("name").value;

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${protocol}://${location.host}/ws/${room}`);

    ws.onopen = ()=>{
        ws.send(JSON.stringify({
            type:"join",
            name:name
        }));
    };

    ws.onmessage = (e)=>{
        const data = JSON.parse(e.data);

        if(data.type==="log"){
            log(data.msg);
        }

        if(data.type==="state"){
            renderState(data);
        }
    };
}

function startGame(){
    ws.send(JSON.stringify({type:"start"}));
}

function play(card){
    ws.send(JSON.stringify({
        type:"play",
        card:card
    }));
}

function challenge(){
    ws.send(JSON.stringify({
        type:"challenge"
    }));
}

function renderState(data){
    document.getElementById("players").innerHTML =
        data.players.map(p =>
            `${p.name} ❤️${p.hp} (${p.cards}张)`
        ).join("<br>");

    document.getElementById("hand").innerHTML =
        data.your_hand.map(c =>
            `<button onclick="play('${c}')">${c}</button>`
        ).join("");
}
