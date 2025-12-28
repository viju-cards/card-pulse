document.getElementById('loginBtn').addEventListener('click', async () => {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const status = document.getElementById('status');

    status.innerText = "Verbinde...";

    try {
        const response = await fetch('https://pokecardscout-api.onrender.com/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json();

        if (response.ok) {
            // Token sicher in der Extension speichern
            chrome.storage.local.set({ 'userToken': data.token, 'isPremium': data.is_premium }, () => {
                status.style.color = "green";
                status.innerText = "Erfolgreich eingeloggt!";
                setTimeout(() => window.close(), 1500); // Fenster nach 1.5s schließen
            });
        } else {
            status.style.color = "red";
            status.innerText = "Login fehlgeschlagen.";
        }
    } catch (err) {
        status.innerText = "Serverfehler.";
    }
});
