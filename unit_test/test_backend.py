import importlib.util
from pathlib import Path

import pytest


APP_PATH = Path(__file__).resolve().parents[1] / "backend" / "app.py"
SPEC = importlib.util.spec_from_file_location("finance_backend", APP_PATH)
backend = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backend)


@pytest.fixture(autouse=True)
def reset_backend_data(tmp_path):
    backend.DATA_FILE = str(tmp_path / "lendings.json")
    backend.LOANS_DATA_FILE = str(tmp_path / "loans.json")
    backend.CHITS_DATA_FILE = str(tmp_path / "chits.json")
    backend.lendings = []
    backend.loans = []
    backend.chits = []
    backend.save_lendings()
    backend.save_loans()
    backend.save_chits()
    yield
    backend.lendings = []
    backend.loans = []
    backend.chits = []
    backend.save_lendings()
    backend.save_loans()
    backend.save_chits()


@pytest.fixture
def client():
    backend.app.config["TESTING"] = True
    with backend.app.test_client() as client:
        yield client


def test_add_lending_success(client):
    payload = {
        "id": "1",
        "name": "Alice",
        "date": "2026-09-01",
        "principalAmount": 20000,
        "returnAmount": 24000,
        "interestAmount": 4000,
        "type": "monthly",
        "notes": "House loan",
        "received": 0,
        "payments": [],
        "status": "active"
    }

    response = client.post("/add_lending", json=payload)

    assert response.status_code == 201
    data = response.get_json()
    assert data["status"] == "success"
    assert data["lending"]["name"] == "Alice"
    assert backend.lendings[0]["principalAmount"] == 20000


def test_record_payment_updates_received_and_schedule(client):
    backend.lendings = [{
        "id": "1",
        "name": "Alice",
        "date": "2026-09-01",
        "principalAmount": 10000,
        "returnAmount": 12000,
        "interestAmount": 2000,
        "type": "monthly",
        "received": 0,
        "payments": [],
        "status": "active",
        "schedule": [{
            "amount": 3000,
            "received": False,
            "dueDate": "2026-09-10"
        }]
    }]
    backend.save_lendings()

    response = client.post("/record_payment/1", json={"amount": 3000, "date": "2026-09-02"})

    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "success"
    assert data["lending"]["received"] == 3000
    assert data["lending"]["schedule"][0]["received"] is True


def test_close_lending_moves_record_to_closed_status(client):
    backend.lendings = [{
        "id": "1",
        "name": "Alice",
        "date": "2026-09-01",
        "principalAmount": 10000,
        "returnAmount": 12000,
        "interestAmount": 2000,
        "type": "monthly",
        "received": 3000,
        "payments": [{"date": "2026-09-02", "amount": 3000}],
        "status": "active"
    }]
    backend.save_lendings()

    response = client.post("/close_lending/1")

    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "success"
    assert data["lending"]["status"] == "closed"
    assert data["lending"]["payments"][0]["amount"] == 3000


def test_reopen_lending_moves_record_to_active_status(client):
    backend.lendings = [{
        "id": "1",
        "name": "Alice",
        "date": "2026-09-01",
        "principalAmount": 10000,
        "returnAmount": 12000,
        "interestAmount": 2000,
        "type": "monthly",
        "received": 3000,
        "payments": [],
        "status": "closed",
        "closedAt": "2026-09-03T10:00:00"
    }]
    backend.save_lendings()

    response = client.post("/reopen_lending/1")

    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "success"
    assert data["lending"]["status"] == "active"
    assert "closedAt" not in data["lending"]


def test_add_loan_success(client):
    payload = {
        "id": "10",
        "bankName": "SBI",
        "date": "2026-09-01",
        "loanAmount": 50000,
        "monthlyInterest": 1200,
        "notes": "Business loan"
    }

    response = client.post("/add_loan", json=payload)

    assert response.status_code == 201
    data = response.get_json()
    assert data["status"] == "success"
    assert data["loan"]["bankName"] == "SBI"
    assert backend.loans[0]["loanAmount"] == 50000


def test_record_loan_interest_success(client):
    backend.loans = [{
        "id": "10",
        "bankName": "SBI",
        "date": "2026-09-01",
        "loanAmount": 50000,
        "monthlyInterest": 1200,
        "notes": "Business loan",
        "interestPayments": []
    }]
    backend.save_loans()

    response = client.post("/record_loan_interest/10", json={"amount": 1200, "date": "2026-09-02"})

    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "success"
    assert data["loan"]["interestPayments"][-1]["amount"] == 1200


def test_close_and_reopen_loan(client):
    backend.loans = [{"id": "10", "bankName": "SBI", "loanAmount": 50000, "interestPayments": [], "status": "active"}]
    backend.save_loans()

    close_response = client.post("/close_loan/10")
    reopen_response = client.post("/reopen_loan/10")

    assert close_response.status_code == 200
    assert reopen_response.status_code == 200
    assert reopen_response.get_json()["loan"]["status"] == "active"


def test_add_chit_success(client):
    payload = {
        "id": "20",
        "personName": "Raj",
        "chitAmount": 2500,
        "notes": "Monthly chit"
    }

    response = client.post("/add_chit", json=payload)

    assert response.status_code == 201
    data = response.get_json()
    assert data["status"] == "success"
    assert data["chit"]["personName"] == "Raj"
    assert backend.chits[0]["chitAmount"] == 2500


def test_record_chit_payment_success(client):
    backend.chits = [{
        "id": "20",
        "personName": "Raj",
        "chitAmount": 2500,
        "payments": [],
        "notes": "Monthly chit",
        "createdAt": "2026-09-01T00:00:00"
    }]
    backend.save_chits()

    response = client.post("/record_chit_payment/20", json={"amount": 500, "date": "2026-09-03", "note": "advance"})

    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "success"
    assert data["chit"]["payments"][-1]["amount"] == 500


def test_close_and_reopen_chit(client):
    backend.chits = [{"id": "20", "personName": "Raj", "chitAmount": 2500, "payments": [], "status": "active"}]
    backend.save_chits()

    close_response = client.post("/close_chit/20")
    reopen_response = client.post("/reopen_chit/20")

    assert close_response.status_code == 200
    assert reopen_response.status_code == 200
    assert reopen_response.get_json()["chit"]["status"] == "active"


def test_get_analytics_returns_totals(client):
    backend.lendings = [
        {
            "id": "1",
            "name": "Alice",
            "date": "2026-09-01",
            "principalAmount": 10000,
            "returnAmount": 12000,
            "interestAmount": 2000,
            "type": "monthly",
            "received": 3000,
            "payments": [],
            "status": "active",
            "schedule": [{"amount": 3000, "received": True, "dueDate": "2026-09-10"}]
        },
        {
            "id": "2",
            "name": "Bob",
            "date": "2026-09-02",
            "principalAmount": 5000,
            "returnAmount": 6000,
            "interestAmount": 1000,
            "type": "weekly",
            "received": 5000,
            "payments": [],
            "status": "completed",
            "schedule": []
        }
    ]
    backend.save_lendings()

    response = client.get("/get_analytics")

    assert response.status_code == 200
    data = response.get_json()
    assert data["totalLent"] == 15000
    assert data["totalReceived"] == 8000
    assert data["totalOutstanding"] == 10000
    assert data["totalInterest"] == 3000
