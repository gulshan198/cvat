// Copyright (C) 2020-2022 Intel Corporation
// Copyright (C) CVAT.ai Corporation
//
// SPDX-License-Identifier: MIT

import React from 'react';
import Form from 'antd/lib/form';
import Button from 'antd/lib/button';
import Input from 'antd/lib/input';

import { CombinedState } from 'reducers';
import { usePlugins } from 'utils/hooks';

export interface LoginData {
    credential: string;
    password: string;
}

interface Props {
    renderResetPassword: boolean;
    renderRegistrationComponent: boolean;
    renderBasicLoginComponent: boolean;
    fetching: boolean;
    onSubmit(loginData: LoginData): void;
}

function LoginFormComponent(props: Props): JSX.Element {
    const {
        fetching, onSubmit, renderBasicLoginComponent,
    } = props;

    const [form] = Form.useForm();
    const pluginsToRender = usePlugins(
        (state: CombinedState) => state.plugins.components.loginPage.loginForm,
        props,
        { credential: '' },
    );

    return (
        <Form
            className='cvat-guardex-login-form'
            form={form}
            layout='vertical'
            requiredMark={false}
            onFinish={(loginData: LoginData) => {
                onSubmit(loginData);
            }}
        >
            {renderBasicLoginComponent && (
                <>
                    <Form.Item
                        label='Username'
                        name='credential'
                        rules={[
                            {
                                required: true,
                                message: 'Please enter your username',
                            },
                        ]}
                    >
                        <Input
                            id='credential'
                            autoComplete='username'
                            placeholder='Username'
                            autoFocus
                        />
                    </Form.Item>

                    <Form.Item
                        label='Password'
                        name='password'
                        rules={[
                            {
                                required: true,
                                message: 'Please enter your password',
                            },
                        ]}
                    >
                        <Input.Password
                            id='password'
                            autoComplete='current-password'
                            placeholder='••••••••'
                        />
                    </Form.Item>

                    <Form.Item>
                        <Button
                            className='cvat-guardex-login-submit'
                            type='primary'
                            htmlType='submit'
                            loading={fetching}
                        >
                            Sign in
                        </Button>
                    </Form.Item>
                </>
            )}

            {pluginsToRender.length > 0 && (
                <div className='cvat-guardex-login-plugins'>
                    {pluginsToRender.map(({ component: Component }, index) => (
                        <Component targetProps={props} targetState={{ credential: '' }} key={index} />
                    ))}
                </div>
            )}
        </Form>
    );
}

export default React.memo(LoginFormComponent);
