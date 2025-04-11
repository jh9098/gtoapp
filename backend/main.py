from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from crawler import run_crawler_streaming
import json
import asyncio
from datetime import datetime
from fastapi.responses import JSONResponse

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://dbgapp.netlify.app", 
        "https://gtoapp.netlify.app"  # ✅ 새 프론트엔드 주소 추가
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

active_sessions = {}  # session_cookie: [websocket, websocket, ...]
ongoing_tasks = {}    # session_cookie: asyncio.Task
session_results = {}  # session_cookie: {"hidden": [...], "public": [...], "all": set()}

@app.websocket("/ws/crawl")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        params = await websocket.receive_text()
        data = json.loads(params)

        session_cookie = data.get("session_cookie")
        selected_days = data.get("selected_days", [])
        exclude_keywords = data.get("exclude_keywords", [])
        use_full_range = data.get("use_full_range", True)
        start_id = data.get("start_id")
        end_id = data.get("end_id")
        exclude_ids = set(map(int, data.get("exclude_ids", [])))

        if isinstance(selected_days, str):
            selected_days = [s.strip() for s in selected_days.split(",") if s.strip()]
        if isinstance(exclude_keywords, str):
            exclude_keywords = [k.strip() for k in exclude_keywords.split(",") if k.strip()]

        if session_cookie not in session_results:
            session_results[session_cookie] = {"hidden": [], "public": [], "all": set()}

        if session_cookie not in active_sessions:
            active_sessions[session_cookie] = []
        active_sessions[session_cookie].append(websocket)

        # 새로 접속한 클라이언트에게 이전 결과 먼저 전송
        for h in session_results[session_cookie]["hidden"]:
            await websocket.send_text(json.dumps({"event": "hidden", "data": h}))
        for p in session_results[session_cookie]["public"]:
            await websocket.send_text(json.dumps({"event": "public", "data": p}))

        # 크롤링 태스크가 없으면 시작
        if session_cookie not in ongoing_tasks:
            task = asyncio.create_task(
                stream_to_all_clients(session_cookie, {
                    "session_cookie": session_cookie,
                    "selected_days": selected_days,
                    "exclude_keywords": exclude_keywords,
                    "use_full_range": use_full_range,
                    "start_id": start_id,
                    "end_id": end_id,
                    "exclude_ids": exclude_ids
                })
            )
            ongoing_tasks[session_cookie] = task

        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=20)
            except asyncio.TimeoutError:
                await websocket.send_text("ping")

    except WebSocketDisconnect:
        if session_cookie in active_sessions:
            active_sessions[session_cookie].remove(websocket)
            if not active_sessions[session_cookie]:
                task = ongoing_tasks.pop(session_cookie, None)
                if task:
                    task.cancel()
                del active_sessions[session_cookie]

async def stream_to_all_clients(session_cookie: str, data: dict):
    print(f"🚀 크롤링 시작: {session_cookie} @ {datetime.now()}")
    results = session_results[session_cookie]
    try:
        async for result in run_crawler_streaming(**data):
            data_str = result.get("data")
            csq = None
            if data_str:
                csq_match = next((x for x in data_str.split(" & ") if "csq=" in x), None)
                if csq_match:
                    try:
                        csq = int(csq_match.split("csq=")[-1])
                    except:
                        csq = None

            if csq and csq in results["all"]:
                continue  # 중복 방지
            if csq:
                results["all"].add(csq)

            if result["event"] == "hidden":
                results["hidden"].append(data_str)
            elif result["event"] == "public":
                results["public"].append(data_str)

            for ws in active_sessions.get(session_cookie, []):
                try:
                    await ws.send_text(json.dumps(result))
                except:
                    continue

        for ws in active_sessions.get(session_cookie, []):
            try:
                await ws.send_text(json.dumps({"event": "done", "data": "크롤링 완료"}))
            except:
                pass

    except asyncio.CancelledError:
        print(f"🛑 크롤링 중단: {session_cookie}")
    except Exception as e:
        for ws in active_sessions.get(session_cookie, []):
            try:
                await ws.send_text(json.dumps({"event": "error", "data": str(e)}))
            except:
                pass

@app.get("/api/results")
async def get_saved_results(session_cookie: str, request: Request):
    data = session_results.get(session_cookie)
    
    if not data:
        return JSONResponse(
            content={"status": "not_found", "message": "결과가 없습니다"},
            headers={
                "Access-Control-Allow-Origin": "https://gtoapp.netlify.app",  # 강제 허용
                "Access-Control-Allow-Credentials": "true"
            }
        )

    return JSONResponse(
        content={
            "status": "ok",
            "hidden": data["hidden"],
            "public": data["public"]
        },
        headers={
            "Access-Control-Allow-Origin": "https://gtoapp.netlify.app",  # 강제 허용
            "Access-Control-Allow-Credentials": "true"
        }
    )
