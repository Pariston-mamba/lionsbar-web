let ws = null;
let joined = false;

function log(msg){
    const logDiv = document.getElementById("log");
    logDiv.innerHTML += `<div>${msg}</div>`;
}

function join(){
    if(joined) return;

    const room = document.getElementById("room").value.trim();
    const name = document.getElementById("name").value.trim();

    if(!room || !name){
        alert("請輸入房號與名字");
        return;
    }

    const protocol = location.protocol === "https:" ? "wss" : "ws";

    ws = new WebSocket(`${protocol}://${location.host}/ws/${room}`);

    ws.onopen = ()=>{
        ws.send(JSON.stringify({
            type:"join",
            name:name
        }));

        joined = true;
        document.querySelector("button").disabled = true;
    };

    ws.onmessage = (e)=>{
        const data = JSON.parse(e.data);

        if(data.type==="log"){
            log(data.msg);
        }

        if(data.type==="state"){
            renderState(data);
        }

        if(data.type==="error"){
            alert(data.msg);
        }
    };

    ws.onclose = ()=>{
        joined = false;
    };
}

function startGame(){
    if(ws){
        ws.send(JSON.stringify({type:"start"}));
    }
}

function play(index){
    ws.send(JSON.stringify({
        type:"play",
        index:index
    }));
}

function challenge(){
    ws.send(JSON.stringify({
        type:"challenge"
    }));
}

function renderState(data){
    document.getElementById("players").innerHTML =
        data.players.map(
            p => `${p.name} ❤️${p.hp} (${p.cards})`
        ).join("<br>");

    document.getElementById("hand").innerHTML =
        data.your_hand.map(
            (c,i)=>`<button onclick="play(${i})">${c}</button>`
        ).join("");
}
