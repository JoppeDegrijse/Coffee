// Thema meteen toepassen, nog voor de rest laadt (geen witte flits)
try {
  var t = (JSON.parse(localStorage.getItem("coffee_instellingen") || "{}").thema) || "auto";
  if (t !== "auto") document.documentElement.setAttribute("data-thema", t);
} catch (e) {}
