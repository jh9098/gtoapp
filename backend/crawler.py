import requests
from bs4 import BeautifulSoup
import re
import urllib3
import asyncio
import time

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

MAIN_URL = "https://gto.shopreview.co.kr/usr"
CAMPAIGN_URL_TEMPLATE = "https://gto.shopreview.co.kr/usr/campaign_detail?csq={}"

def get_public_campaigns(session):
    public_campaigns = set()
    for attempt in range(3):
        try:
            response = session.get(MAIN_URL, verify=False, timeout=10)
            response.raise_for_status()
            scripts = BeautifulSoup(response.text, "html.parser").find_all("script")
            for script in scripts:
                matches = re.findall(r'data-csq=["\']?(\d+)', script.text)
                public_campaigns.update(map(int, matches))
            if public_campaigns:
                return public_campaigns
        except requests.exceptions.RequestException:
            time.sleep(3)
    return set()

def fetch_campaign_data(campaign_id, session, public_campaigns, selected_days, exclude_keywords):
    url = CAMPAIGN_URL_TEMPLATE.format(campaign_id)
    try:
        response = session.get(url, verify=False, timeout=10)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")

        if soup.find("script", string="window.location.href = '/usr/login_form';"):
            return None

        participation_time = soup.find("button", class_="butn butn-success", disabled=True)
        participation_time = participation_time.text.strip() if participation_time else ""
        if "시에" in participation_time:
            participation_time = participation_time.replace("시에", "시 00분에")

        product_name_tag = soup.find("h3")
        product_name = product_name_tag.text.strip().replace("&", "") if product_name_tag else "상품명 없음"

        #print(f"🔍 캠페인 {campaign_id} 참여 시간: {participation_time}")
        #print(f"🔍 상품명: {product_name}")

        day_match = re.search(r"(\d{2})일", participation_time)
        if not day_match or day_match.group(0) not in selected_days:
            return None

        if soup.find("button", string="종료된 캠페인 입니다") or \
           soup.find("div", id="alert_msg", string="해당 캠페인은 참여가 불가능한 상태입니다.") or \
           soup.find("button", string="참여 가능 시간이 아닙니다") or \
           soup.find("button", string="캠페인 참여"):
            return None

        if any(keyword in product_name for keyword in exclude_keywords):
            return None

        price = "가격 정보 없음"
        price_tag = soup.find(string=re.compile("총 결제금액"))
        if price_tag:
            price_text = price_tag.find_next("div", style="text-align:right")
            if price_text:
                price_value = re.sub(r"[^\d]", "", price_text.text)
                price = price_value if price_value else price

        product_type = "상품구분 없음"
        for section in soup.find_all("div", class_="row col-sm4 col-12"):
            title = section.find("div", class_="col-6")
            value = section.find("div", style="text-align:right")
            if title and value and "배송" in title.text:
                product_type = value.text.strip()
                break

        shop_name = "쇼핑몰 정보 없음"
        shop_section = soup.find("div", class_="col-sm-9")
        if shop_section:
            shop_img = shop_section.find("img")
            if shop_img and "alt" in shop_img.attrs:
                shop_name = shop_img["alt"].strip()

        text_review = "포토 리뷰"
        if soup.find("label", string="텍스트 리뷰"):
            text_review = "텍스트 리뷰"

        if price != "가격 정보 없음":
            price_num = int(price)
            if "기타배송" in product_type and "스마트스토어" in shop_name and price_num < 90000:
                return None
            if "기타배송" in product_type and "쿠팡" in shop_name and price_num < 28500:
                return None
            if "실배송" in product_type and price_num < 8500:
                return None

        result = f"{product_type} & {text_review} & {shop_name} & {price} & {participation_time} & {product_name} & {url}"
        return (None, result) if campaign_id in public_campaigns else (result, None)
        print(f"결과 {result}")
    except requests.exceptions.RequestException:
        return None

async def run_crawler_streaming(session_cookie, selected_days, exclude_keywords,
                                use_full_range=True, start_id=None, end_id=None, exclude_ids=None):
    session = requests.Session()
    session.cookies.set("PHPSESSID", session_cookie)

    if exclude_ids is None:
        exclude_ids = set()

    public_campaigns = get_public_campaigns(session)
    if not public_campaigns:
        yield {"event": "error", "data": "공개 캠페인 정보를 가져오지 못했습니다."}
        return

    if use_full_range:
        start_id = min(public_campaigns)
        end_id = max(public_campaigns)
    else:
        if start_id is None or end_id is None:
            yield {"event": "error", "data": "수동 범위 사용 시 start_id, end_id는 필수입니다."}
            return

    print(f"📡 실행할 캠페인 범위: {start_id} ~ {end_id}")

    for cid in range(start_id, end_id + 1):
        if cid in exclude_ids:
            continue

        result = await asyncio.to_thread(
            fetch_campaign_data,
            cid, session, public_campaigns, selected_days, exclude_keywords
        )
        if result:
            h, p = result
            if h:
                yield {"event": "hidden", "data": h}
            if p:
                yield {"event": "public", "data": p}

    yield {"event": "done", "data": "크롤링 완료"}

