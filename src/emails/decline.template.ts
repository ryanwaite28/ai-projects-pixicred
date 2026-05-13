import Handlebars from 'handlebars';
import declineTemplateSource from './templates/decline.hbs';
import type { Application } from '../types/index.js';

const declineTemplate = Handlebars.compile(declineTemplateSource);

export interface SendEmailInput {
  to: string;
  subject: string;
  htmlBody: string;
  textBody: string;
}

export function buildDeclineEmail(application: Application): SendEmailInput {
  const htmlBody = declineTemplate({
    firstName: application.firstName,
    lastName: application.lastName,
  });

  return {
    to: application.email,
    subject: 'Your PixiCred Application Decision',
    htmlBody,
    textBody: `Dear ${application.firstName} ${application.lastName},\n\nThank you for applying for a PixiCred credit card. After reviewing your application, we are unable to approve your request at this time.\n\nYou are welcome to reapply once any existing open account has been closed.\n\nSincerely,\nThe PixiCred Team`,
  };
}
