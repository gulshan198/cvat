// Copyright (C) 2020-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import './styles.scss';

import React from 'react';
import { RouteComponentProps, useHistory } from 'react-router';
import { withRouter } from 'react-router-dom';

import LoginForm, { LoginData } from './login-form';

const GUARDEX_LOGO = 'https://app.guardex.ai/full-text-logo.png';

interface LoginPageComponentProps {
    fetching: boolean;
    renderResetPassword: boolean;
    renderRegistrationComponent: boolean;
    renderBasicLoginComponent: boolean;
    hasEmailVerificationBeenSent: boolean;
    onLogin: (credential: string, password: string) => void;
}

function LoginPageComponent(props: LoginPageComponentProps & RouteComponentProps): JSX.Element {
    const history = useHistory();
    const {
        fetching, renderResetPassword, renderRegistrationComponent, renderBasicLoginComponent,
        hasEmailVerificationBeenSent, onLogin,
    } = props;

    if (hasEmailVerificationBeenSent) {
        history.push('/auth/email-verification-sent');
    }

    return (
        <div className='cvat-guardex-login'>
            <div className='cvat-guardex-login-card'>
                <div className='cvat-guardex-login-header'>
                    <img src={GUARDEX_LOGO} alt='Guardex' />
                    <p>Sign in to continue</p>
                </div>
                <LoginForm
                    fetching={fetching}
                    renderResetPassword={renderResetPassword}
                    renderRegistrationComponent={renderRegistrationComponent}
                    renderBasicLoginComponent={renderBasicLoginComponent}
                    onSubmit={(loginData: LoginData): void => {
                        onLogin(loginData.credential, loginData.password);
                    }}
                />
            </div>
        </div>
    );
}

export default withRouter(LoginPageComponent);
