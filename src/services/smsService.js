// SMS Service - Frontend interface for sending SMS via Twilio

export async function sendWelcomeSMS(phone, tag) {
  const appUrl = import.meta.env.VITE_APP_URL || window.location.origin;
  const guestLink = `${appUrl}/guest/${tag}`;
  
  const message = `Welcome to The Royce Hotel. Your valet tag is #${tag} — we'll take care of the rest.\n\nWhen you're ready for your vehicle, request it here: ${guestLink}`;

  console.log('Attempting to send SMS to:', phone);
  console.log('Message:', message);

  try {
    const response = await fetch('/api/send-sms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: phone,
        message: message,
      }),
    });

    console.log('Response status:', response.status);
    
    const data = await response.json();
    console.log('Response data:', data);

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send SMS');
    }

    return { success: true, messageSid: data.messageSid };
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
}

export async function sendVehicleReadySMS(phone, tag) {
  const message = `Your vehicle (#${tag}) is ready at the driveway. Thank you for choosing The Royce Hotel!`;

  try {
    const response = await fetch('/api/send-sms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: phone,
        message: message,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send SMS');
    }

    return { success: true, messageSid: data.messageSid };
  } catch (error) {
    console.error('Error sending SMS:', error);
    throw error;
  }
}
